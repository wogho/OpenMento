/**
 * budget-guard.ts — LLM 토큰 비용 예산 초과 여부 확인 서비스
 *
 * plan.md Phase 2-5 개선 ④: Budget Management 연동 준비
 * plan.md Phase 2-7: 예산 관리 구현 시 이 파일을 완성합니다.
 *
 * ── 현재 상태 ─────────────────────────────────────────────────────────────
 *
 *   Phase 2-7 (예산 관리) 미구현 상태이므로 기본값 허용(pass)으로 동작합니다.
 *   Phase 2-7 완성 시 DB의 budget_accounts 테이블을 조회하여 실제 잔액을 검사합니다.
 *
 * ── 예상 연동 전략 (Phase 2-7) ───────────────────────────────────────────
 *
 *   1. institutionId 기준으로 budget_accounts 테이블 조회
 *   2. remaining_budget_usd <= 0 이면 BUDGET_EXCEEDED 반환
 *   3. 코드 리뷰 평균 예상 비용($0.01)을 기준으로 예비 예산 확인
 */

import { logger } from '../utils/logger.js';

export type BudgetCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Webhook 기반 Proactive 개입 전 예산 잔액을 확인합니다.
 *
 * @param institutionId - 원장 기관 UUID
 * @param _agentId - ai_instructor 에이전트 UUID (Phase 2-7에서 모델별 단가 적용)
 * @returns 허용 여부 및 거부 사유
 */
export async function checkProactiveBudget(
  institutionId: string,
  _agentId: string,
): Promise<BudgetCheckResult> {
  // TODO Phase 2-7: DB에서 budget_accounts 조회 후 실제 잔액 확인
  // const account = await db.select()...
  // if (account.remainingUsd <= 0) return { allowed: false, reason: '예산 소진' };

  logger.debug(
    { institutionId },
    '[budget-guard] Phase 2-7 미구현 — 예산 검사 통과 (허용)',
  );
  return { allowed: true };
}
