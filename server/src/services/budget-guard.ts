/**
 * budget-guard.ts — LLM 토큰 비용 예산 관리 서비스 (Phase 2-7 완성)
 *
 * ── 책임 ──────────────────────────────────────────────────────────────────
 *
 *  1. recordCostEvent()      — LLM 응답 후 토큰 수 → cost_events DB 저장
 *  2. checkProactiveBudget() — LLM 호출 전 예산 잔액 검사:
 *     • budget_policies에서 기관/에이전트 월 예산 상한 조회
 *     • cost_events 이번 달 집계로 실 소비량 계산
 *     • 100% 초과 + onExceed='pause' → 에이전트 isActive=false
 *     • alertThresholdPct(기본 80%) 이상 → Slack Soft Alert 발송
 *
 * ── 모델 단가 ─────────────────────────────────────────────────────────────
 *
 *  MODEL_PRICING 맵에서 (inputPer1k + outputPer1k) USD 단가로 costUsd를 계산합니다.
 *  맵에 없는 모델은 DEFAULT_PRICING(GPT-4o 기준)을 사용합니다.
 */

import {
  db,
  budgetPolicies,
  costEvents,
  agents,
  eq,
  and,
  isNull,
  gte,
  lte,
  sql,
} from '@educlip/db';
import { logger } from '../utils/logger.js';

// ── 모델별 USD 단가 (per 1,000 tokens) ───────────────────────────────────────
// 참조: OpenAI Pricing (2025-01) / Anthropic Pricing (2025-01)
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  // OpenAI
  'gpt-4o':        { inputPer1k: 0.005,    outputPer1k: 0.015 },
  'gpt-4o-mini':   { inputPer1k: 0.000150, outputPer1k: 0.000600 },
  'gpt-4-turbo':   { inputPer1k: 0.010,    outputPer1k: 0.030 },
  'gpt-3.5-turbo': { inputPer1k: 0.000500, outputPer1k: 0.001500 },
  // Anthropic
  'claude-3-5-sonnet-20241022': { inputPer1k: 0.003,    outputPer1k: 0.015 },
  'claude-3-5-haiku-20241022':  { inputPer1k: 0.000800, outputPer1k: 0.004 },
  'claude-3-opus-20240229':     { inputPer1k: 0.015,    outputPer1k: 0.075 },
  'claude-3-haiku-20240307':    { inputPer1k: 0.000250, outputPer1k: 0.001250 },
};

const DEFAULT_PRICING = { inputPer1k: 0.005, outputPer1k: 0.015 }; // GPT-4o 기준

export type BudgetCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface RecordCostParams {
  institutionId: string;
  agentId: string | null;
  provider: string; // 'openai' | 'anthropic' 등
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

function calcCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (
    (inputTokens / 1000) * pricing.inputPer1k +
    (outputTokens / 1000) * pricing.outputPer1k
  );
}

function currentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

async function getMonthlySpend(
  institutionId: string,
  agentId?: string | null,
): Promise<number> {
  const { start, end } = currentMonthRange();
  const conditions = [
    eq(costEvents.institutionId, institutionId),
    gte(costEvents.createdAt, start),
    lte(costEvents.createdAt, end),
  ];
  if (agentId) conditions.push(eq(costEvents.agentId, agentId));

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${costEvents.costUsd}), 0)` })
    .from(costEvents)
    .where(and(...conditions));

  return Number(row?.total ?? 0);
}

async function sendSoftAlertIfNeeded(
  institutionId: string,
  policy: { limitUsd: number; alertThresholdPct: number; agentId: string | null },
  spendUsd: number,
): Promise<void> {
  const pct = (spendUsd / policy.limitUsd) * 100;
  if (pct < policy.alertThresholdPct) return;

  const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
  if (!webhookUrl) return;

  const label = policy.agentId
    ? `에이전트(${policy.agentId.slice(0, 8)}…)`
    : '전체 기관';

  const payload = {
    text:
      `⚠️ *[EduClip 예산 ${policy.alertThresholdPct}% 경고]* ${label}\n` +
      `이번 달 LLM 사용량이 *${pct.toFixed(1)}%* 에 도달했습니다.\n` +
      `💰 사용: $${spendUsd.toFixed(4)} / 한도: $${policy.limitUsd.toFixed(2)}`,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, institutionId }, '[budget-guard] Soft Alert 발송 실패');
    } else {
      logger.info({ pct: pct.toFixed(1), institutionId }, '[budget-guard] Soft Alert 발송 완료');
    }
  } catch (err) {
    logger.warn({ err, institutionId }, '[budget-guard] Soft Alert 발송 예외');
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * LLM 호출 후 토큰 수를 cost_events에 기록합니다.
 * DB 오류가 발생해도 호출자에게 예외를 전파하지 않습니다 (fire-and-forget).
 */
export async function recordCostEvent(params: RecordCostParams): Promise<void> {
  const { institutionId, agentId, provider, model, inputTokens, outputTokens } = params;
  const costUsd = calcCostUsd(model, inputTokens, outputTokens);

  try {
    await db.insert(costEvents).values({
      institutionId,
      agentId,
      provider,
      model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costUsd,
    });

    logger.debug(
      { institutionId, agentId, model, inputTokens, outputTokens, costUsd },
      '[budget-guard] cost_events 기록 완료',
    );
  } catch (err) {
    logger.error({ err, institutionId, model }, '[budget-guard] cost_events 기록 실패');
  }
}

/**
 * LLM 호출 전 예산 잔액을 확인합니다.
 *
 * 우선순위: 에이전트별 정책 → 기관 전체 정책 → 미설정(허용)
 *
 * @param institutionId - 원장 기관 UUID
 * @param agentId      - 실행할 에이전트 UUID
 * @returns 허용 여부 및 거부 사유
 */
export async function checkProactiveBudget(
  institutionId: string,
  agentId: string,
): Promise<BudgetCheckResult> {
  // 1) 에이전트별 정책 우선 조회
  const [agentPolicy] = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.institutionId, institutionId),
        eq(budgetPolicies.agentId, agentId),
        eq(budgetPolicies.isActive, 'true'),
      ),
    )
    .limit(1);

  // 2) 에이전트별 없으면 기관 전체(agentId IS NULL) 정책 확인
  let effectivePolicy = agentPolicy;
  if (!effectivePolicy) {
    const [globalPolicy] = await db
      .select()
      .from(budgetPolicies)
      .where(
        and(
          eq(budgetPolicies.institutionId, institutionId),
          isNull(budgetPolicies.agentId),
          eq(budgetPolicies.isActive, 'true'),
        ),
      )
      .limit(1);
    effectivePolicy = globalPolicy;
  }

  if (!effectivePolicy) {
    logger.debug({ institutionId, agentId }, '[budget-guard] 예산 정책 없음 — 허용');
    return { allowed: true };
  }

  const spendUsd = await getMonthlySpend(
    institutionId,
    effectivePolicy.agentId ?? null,
  );
  const pctUsed = (spendUsd / effectivePolicy.limitUsd) * 100;

  logger.debug(
    { institutionId, agentId, spendUsd, limitUsd: effectivePolicy.limitUsd, pctUsed },
    '[budget-guard] 예산 검사',
  );

  // 100% 초과 → 차단
  if (pctUsed >= 100) {
    if (effectivePolicy.onExceed === 'pause') {
      await db
        .update(agents)
        .set({ isActive: false })
        .where(
          and(eq(agents.id, agentId), eq(agents.institutionId, institutionId)),
        );
      logger.warn(
        { agentId, pctUsed: pctUsed.toFixed(1) },
        '[budget-guard] 예산 초과 — 에이전트 자동 비활성화',
      );
    }
    return {
      allowed: false,
      reason: `이번 달 LLM 예산(${effectivePolicy.period})이 소진되었습니다. ` +
        `($${spendUsd.toFixed(4)} / $${effectivePolicy.limitUsd.toFixed(2)})`,
    };
  }

  // alertThresholdPct% 이상 → Soft Alert (fire-and-forget)
  if (pctUsed >= effectivePolicy.alertThresholdPct) {
    void sendSoftAlertIfNeeded(
      institutionId,
      {
        limitUsd: effectivePolicy.limitUsd,
        alertThresholdPct: effectivePolicy.alertThresholdPct,
        agentId: effectivePolicy.agentId ?? null,
      },
      spendUsd,
    );
  }

  return { allowed: true };
}
