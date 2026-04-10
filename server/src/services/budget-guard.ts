/**
 * budget-guard.ts — LLM 토큰 비용 예산 관리 서비스 (Phase 2-7 개선 4종 적용)
 *
 * ── 책임 ──────────────────────────────────────────────────────────────────
 *
 *  1. recordCostEvent()       — 인메모리 버퍼 → Bulk Insert (개선③ 성능)
 *  2. checkProactiveBudget()  — Redis 캐시 기반 잔액 검사 (개선② 성능)
 *     • 100% 초과 + onExceed='pause' → isActive=false + budgetPausedAt 기록 (개선①)
 *     • alertThresholdPct(기본 80%) 이상 → Slack Soft Alert
 *  3. loadPricingFromDb()     — DB model_pricing 테이블 로드 (개선④ 유연성)
 *     • 1시간 TTL 인메모리 캐시, 미등록 모델은 DEFAULT_PRICING 폴백
 *
 * ── 개선 요약 ─────────────────────────────────────────────────────────────
 *
 *  ① 월별 자동 재활성화 — budgetPausedAt 으로 예산 정지 에이전트 구분
 *  ② 비용 SUM 쿼리 캐시 — Redis INCRBYFLOAT(REDIS_URL 있을 때) / 인메모리 폴백
 *  ③ Bulk Insert 버퍼 — 10초 / 100건 단위 일괄 저장
 *  ④ DB 단가 관리 — model_pricing 테이블, 1시간 캐시
 */

import {
  db,
  budgetPolicies,
  costEvents,
  modelPricing,
  agents,
  eq,
  and,
  isNull,
  gte,
  lte,
  sql,
} from '@openmento/db';
import { Redis as IORedis } from 'ioredis';
import { logger } from '../utils/logger.js';

// ══════════════════════════════════════════════════════════════════════════════
// 개선④ — DB 단가 캐시
// ══════════════════════════════════════════════════════════════════════════════

/** 하드코딩 폴백 단가 (DB에 없는 모델) */
const DEFAULT_PRICING = { inputPer1k: 0.005, outputPer1k: 0.015 }; // GPT-4o 기준

const BUILTIN_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
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

let _pricingCache: Map<string, { inputPer1k: number; outputPer1k: number }> | null = null;
let _pricingCacheExpiresAt = 0;
const PRICING_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

/** DB에서 단가를 로드하고 1시간 캐싱. 실패 시 내장 폴백 사용. */
async function loadPricingFromDb(): Promise<Map<string, { inputPer1k: number; outputPer1k: number }>> {
  if (_pricingCache && Date.now() < _pricingCacheExpiresAt) return _pricingCache;

  try {
    const rows = await db
      .select({
        model: modelPricing.model,
        inputPer1k: modelPricing.inputPer1k,
        outputPer1k: modelPricing.outputPer1k,
      })
      .from(modelPricing)
      .where(eq(modelPricing.isActive, true));

    const map = new Map<string, { inputPer1k: number; outputPer1k: number }>(
      Object.entries(BUILTIN_PRICING), // 내장값 먼저
    );
    for (const row of rows) {
      map.set(row.model, { inputPer1k: row.inputPer1k, outputPer1k: row.outputPer1k });
    }

    _pricingCache = map;
    _pricingCacheExpiresAt = Date.now() + PRICING_CACHE_TTL_MS;
    logger.debug({ count: rows.length }, '[budget-guard] 단가 캐시 갱신');
    return map;
  } catch (err) {
    logger.warn({ err }, '[budget-guard] DB 단가 로드 실패 — 내장 폴백 사용');
    const fallback = new Map<string, { inputPer1k: number; outputPer1k: number }>(
      Object.entries(BUILTIN_PRICING),
    );
    return fallback;
  }
}

/** 단가 캐시를 강제 무효화 (단가 변경 API 후 즉시 반영용) */
export function invalidatePricingCache(): void {
  _pricingCache = null;
  _pricingCacheExpiresAt = 0;
}

async function calcCostUsd(model: string, inputTokens: number, outputTokens: number): Promise<number> {
  const pricing = (await loadPricingFromDb()).get(model) ?? DEFAULT_PRICING;
  return (
    (inputTokens / 1000) * pricing.inputPer1k +
    (outputTokens / 1000) * pricing.outputPer1k
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 개선③ — Bulk Insert 버퍼
// ══════════════════════════════════════════════════════════════════════════════

interface CostEventBuffer {
  institutionId: string;
  agentId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

const FLUSH_INTERVAL_MS  = 10_000; // 10초마다 자동 플러시
const FLUSH_BATCH_SIZE   = 100;    // 100건 누적 시 즉시 플러시

const _buffer: CostEventBuffer[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushBuffer(): Promise<void> {
  if (_buffer.length === 0) return;
  const batch = _buffer.splice(0, _buffer.length);
  try {
    await db.insert(costEvents).values(batch);
    logger.debug({ count: batch.length }, '[budget-guard] cost_events Bulk Insert 완료');
  } catch (err) {
    logger.error({ err, count: batch.length }, '[budget-guard] cost_events Bulk Insert 실패');
    // 실패한 배치를 앞에 다시 삽입하지 않음 — 손실 허용 (비용 로그는 best-effort)
  }
}

/** 프로세스 초기화 시 버퍼 플러시 타이머 시작 */
function ensureFlushTimer(): void {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => { void flushBuffer(); }, FLUSH_INTERVAL_MS);
  // Node.js 프로세스 종료 시 남은 버퍼 플러시
  process.once('beforeExit', () => { void flushBuffer(); });
}

// ══════════════════════════════════════════════════════════════════════════════
// 개선② — Redis 기반 월 소비 캐시 (INCRBYFLOAT)
// ══════════════════════════════════════════════════════════════════════════════

let _redis: IORedis | null = null;
let _redisInitialized = false;

/** Redis 클라이언트 싱글턴 (REDIS_URL 없으면 null 반환) */
function getRedisClient(): IORedis | null {
  if (_redisInitialized) return _redis;
  _redisInitialized = true;
  const url = process.env['REDIS_URL'];
  if (!url) return null;
  try {
    _redis = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    logger.info('[budget-guard] Redis 연결 초기화 (비용 캐시용)');
    return _redis;
  } catch (err) {
    logger.warn({ err }, '[budget-guard] Redis 초기화 실패 — DB SUM 폴백 사용');
    return null;
  }
}

function spendCacheKey(institutionId: string, agentId: string | null, yearMonth: string): string {
  return `openmento:budget:spend:${institutionId}:${agentId ?? 'global'}:${yearMonth}`;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    end:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

async function getMonthlySpend(institutionId: string, agentId?: string | null): Promise<number> {
  const yearMonth = currentYearMonth();
  const key = spendCacheKey(institutionId, agentId ?? null, yearMonth);

  // Redis 캐시 조회
  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached !== null) return parseFloat(cached);
    } catch { /* 실패 시 DB 폴백 */ }
  }

  // DB SUM 폴백
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

  const total = Number(row?.total ?? 0);

  // 조회 결과를 Redis에 써두고 다음 조회부터 캐시 적중
  const redis2 = getRedisClient();
  if (redis2) {
    const secondsUntilMonthEnd = Math.ceil(
      (currentMonthRange().end.getTime() - Date.now()) / 1000,
    );
    redis2.set(key, String(total), 'EX', Math.max(secondsUntilMonthEnd, 1)).catch(() => {});
  }

  return total;
}

/** recordCostEvent 내부에서 Redis 캐시에 costUsd를 증분합니다. */
async function incrementRedisSpend(
  institutionId: string,
  agentId: string | null,
  costUsd: number,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  const key = spendCacheKey(institutionId, agentId, currentYearMonth());
  const secondsUntilMonthEnd = Math.ceil(
    (currentMonthRange().end.getTime() - Date.now()) / 1000,
  );
  try {
    await redis.incrbyfloat(key, costUsd);
    await redis.expire(key, Math.max(secondsUntilMonthEnd, 1));
  } catch { /* Redis 오류는 무시 */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// Soft Alert 발송
// ══════════════════════════════════════════════════════════════════════════════

// 중복 알림 방지: 기관/에이전트별 마지막 알림 발송 시각 추적 (프로세스 내)
const _alertSentAt = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1시간 쿨다운

async function sendSoftAlertIfNeeded(
  institutionId: string,
  policy: { limitUsd: number; alertThresholdPct: number; agentId: string | null },
  spendUsd: number,
): Promise<void> {
  const pct = (spendUsd / policy.limitUsd) * 100;
  if (pct < policy.alertThresholdPct) return;

  const alertKey = `${institutionId}:${policy.agentId ?? 'global'}`;
  const lastSent = _alertSentAt.get(alertKey) ?? 0;
  if (Date.now() - lastSent < ALERT_COOLDOWN_MS) return; // 쿨다운 중

  const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
  if (!webhookUrl) return;

  const label = policy.agentId
    ? `에이전트(${policy.agentId.slice(0, 8)}…)`
    : '전체 기관';

  const payload = {
    text:
      `⚠️ *[OpenMento 예산 ${policy.alertThresholdPct}% 경고]* ${label}\n` +
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
    if (res.ok) {
      _alertSentAt.set(alertKey, Date.now());
      logger.info({ pct: pct.toFixed(1), institutionId }, '[budget-guard] Soft Alert 발송 완료');
    } else {
      logger.warn({ status: res.status, institutionId }, '[budget-guard] Soft Alert 발송 실패');
    }
  } catch (err) {
    logger.warn({ err, institutionId }, '[budget-guard] Soft Alert 발송 예외');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 공개 API
// ══════════════════════════════════════════════════════════════════════════════

export type BudgetCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface RecordCostParams {
  institutionId: string;
  agentId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * LLM 호출 후 토큰 수를 기록합니다.
 *
 * 개선②: Redis INCRBYFLOAT으로 실시간 캐시 증분
 * 개선③: 인메모리 버퍼에 쌓아두다가 10초/100건 단위 Bulk Insert
 */
export async function recordCostEvent(params: RecordCostParams): Promise<void> {
  ensureFlushTimer();
  const { institutionId, agentId, provider, model, inputTokens, outputTokens } = params;
  const costUsd = await calcCostUsd(model, inputTokens, outputTokens);

  // 버퍼에 추가
  _buffer.push({ institutionId, agentId, provider, model, promptTokens: inputTokens, completionTokens: outputTokens, costUsd });

  // Redis 캐시 증분 (fire-and-forget)
  void incrementRedisSpend(institutionId, agentId, costUsd);

  logger.debug({ institutionId, agentId, model, costUsd }, '[budget-guard] 비용 이벤트 버퍼 추가');

  // 버퍼 임계치 초과 시 즉시 플러시
  if (_buffer.length >= FLUSH_BATCH_SIZE) {
    void flushBuffer();
  }
}

/**
 * LLM 호출 전 예산 잔액을 확인합니다.
 *
 * 개선①: 예산 정지 시 budgetPausedAt 기록 (월별 재활성화 Cron 추적용)
 * 개선②: Redis 캐시으로 DB SUM 쿼리 생략
 */
export async function checkProactiveBudget(
  institutionId: string,
  agentId: string,
): Promise<BudgetCheckResult> {
  // 에이전트별 정책 우선, 없으면 기관 전체 정책
  const [agentPolicy] = await db
    .select()
    .from(budgetPolicies)
    .where(and(
      eq(budgetPolicies.institutionId, institutionId),
      eq(budgetPolicies.agentId, agentId),
      eq(budgetPolicies.isActive, 'true'),
    ))
    .limit(1);

  let effectivePolicy = agentPolicy;
  if (!effectivePolicy) {
    const [globalPolicy] = await db
      .select()
      .from(budgetPolicies)
      .where(and(
        eq(budgetPolicies.institutionId, institutionId),
        isNull(budgetPolicies.agentId),
        eq(budgetPolicies.isActive, 'true'),
      ))
      .limit(1);
    effectivePolicy = globalPolicy;
  }

  if (!effectivePolicy) {
    logger.debug({ institutionId, agentId }, '[budget-guard] 예산 정책 없음 — 허용');
    return { allowed: true };
  }

  // 개선②: Redis 캐시 → DB SUM 순으로 잔액 조회
  const spendUsd = await getMonthlySpend(institutionId, effectivePolicy.agentId ?? null);
  const pctUsed  = (spendUsd / effectivePolicy.limitUsd) * 100;

  logger.debug(
    { institutionId, agentId, spendUsd, limitUsd: effectivePolicy.limitUsd, pctUsed },
    '[budget-guard] 예산 검사',
  );

  // 100% 초과 → 차단
  if (pctUsed >= 100) {
    if (effectivePolicy.onExceed === 'pause') {
      // 개선①: budgetPausedAt 기록 → 월별 Cron이 이 필드로 재활성화 대상 식별
      await db
        .update(agents)
        .set({ isActive: false, budgetPausedAt: new Date() })
        .where(and(eq(agents.id, agentId), eq(agents.institutionId, institutionId)));
      logger.warn(
        { agentId, pctUsed: pctUsed.toFixed(1) },
        '[budget-guard] 예산 초과 — 에이전트 자동 비활성화 (budgetPausedAt 기록)',
      );
    }
    return {
      allowed: false,
      reason:
        `이번 달 LLM 예산(${effectivePolicy.period})이 소진되었습니다. ` +
        `($${spendUsd.toFixed(4)} / $${effectivePolicy.limitUsd.toFixed(2)})`,
    };
  }

  // Soft Alert (alertThresholdPct% 이상, 1시간 쿨다운)
  if (pctUsed >= effectivePolicy.alertThresholdPct) {
    void sendSoftAlertIfNeeded(
      institutionId,
      { limitUsd: effectivePolicy.limitUsd, alertThresholdPct: effectivePolicy.alertThresholdPct, agentId: effectivePolicy.agentId ?? null },
      spendUsd,
    );
  }

  return { allowed: true };
}
