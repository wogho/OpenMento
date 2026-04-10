/**
 * portfolio-stale-cleaner.ts — Stale Session 자동 정리 스케줄러 (Phase 4-1 개선②)
 *
 * Phase 2의 Heartbeat 스케줄러와 연동하여,
 * 24시간 이상 응답이 없는 포트폴리오 워크플로우를 자동으로 'abandoned'로 전환합니다.
 *
 * 동작 흐름:
 *   1. goals.status = 'active' AND goals.updatedAt < (now - 24h) 인 포트폴리오 목표 탐색
 *   2. portfolio_projects.status를 'abandoned'로 전환
 *   3. goals.status를 'failed'로 전환 (이유: 'STALE_SESSION')
 *   4. 수강생에게 리마인드 알림 발송 (Slack / 포털 알림)
 *
 * 트리거: Phase 2 Heartbeat 스케줄러에서 매일 오전 3시에 호출
 *   routines 테이블에 'portfolio-stale-cleaner' 루틴 시드 필요
 */

import {
  db,
  goals,
  portfolioProjects,
  eq,
  and,
  lt,
  sql,
} from '@openmento/db';
import { sendSystemAlert } from './slack-notifier.js';

const STALE_THRESHOLD_HOURS = 24;

export interface StaleCleanupResult {
  scanned: number;
  abandoned: number;
  notified: number;
  errors: string[];
}

/**
 * 메인 엔트리 포인트 — Heartbeat 스케줄러에서 호출합니다.
 * `pnpm --filter server exec tsx src/services/portfolio-stale-cleaner.ts`로 단독 실행도 가능.
 */
export async function cleanStalePortfolioSessions(): Promise<StaleCleanupResult> {
  const result: StaleCleanupResult = { scanned: 0, abandoned: 0, notified: 0, errors: [] };

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

  // 1. 활성 상태이지만 24시간 이상 업데이트 없는 포트폴리오 Goal 조회
  const staleGoals = await db
    .select({
      goalId: goals.id,
      institutionId: goals.institutionId,
      sharedContext: goals.sharedContext,
    })
    .from(goals)
    .where(
      and(
        eq(goals.status, 'active'),
        lt(goals.updatedAt, staleThreshold),
        // portfolio 워크플로우 식별: title에 '포트폴리오 워크플로우' 포함
        sql`${goals.title} LIKE '%포트폴리오 워크플로우%'`,
      ),
    );

  result.scanned = staleGoals.length;
  if (staleGoals.length === 0) return result;

  for (const staleGoal of staleGoals) {
    try {
      const ctx = staleGoal.sharedContext as { projectId?: string; personaId?: string } | null;
      const projectId = ctx?.projectId;

      // 2a. portfolio_projects → abandoned
      if (projectId) {
        await db
          .update(portfolioProjects)
          .set({ status: 'abandoned', updatedAt: new Date() })
          .where(eq(portfolioProjects.id, projectId));
      }

      // 2b. goals → failed (이유: STALE_SESSION)
      await db
        .update(goals)
        .set({
          status: 'failed',
          result: {
            reason: 'STALE_SESSION',
            message: `${STALE_THRESHOLD_HOURS}시간 이상 수강생 응답 없음으로 자동 종료`,
            abandonedAt: new Date().toISOString(),
          },
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, staleGoal.goalId));

      result.abandoned++;

      // 3. 수강생 리마인드 알림 (Slack + 향후 포털 알림 WebSocket)
      if (staleGoal.institutionId) {
        await sendStaleSessionReminder(staleGoal.goalId, staleGoal.institutionId);
        result.notified++;
      }
    } catch (err) {
      result.errors.push(
        `goalId=${staleGoal.goalId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 처리 결과 요약을 Slack으로 알림
  if (result.abandoned > 0) {
    await sendSystemAlert(
      `[포트폴리오 Stale Session 정리] ` +
        `스캔: ${result.scanned}건, ` +
        `abandoned: ${result.abandoned}건, ` +
        `알림: ${result.notified}건` +
        (result.errors.length > 0 ? `, 오류: ${result.errors.length}건` : ''),
    );
  }

  return result;
}

/** 수강생에게 리마인드 알림 (Slack DM 또는 포털 알림) */
async function sendStaleSessionReminder(
  goalId: string,
  _institutionId: string,
): Promise<void> {
  const message =
    `[포트폴리오 기획서 리마인드]\n` +
    `24시간 이상 참여가 중단된 포트폴리오 워크플로우가 자동 종료되었습니다.\n` +
    `Goal ID: ${goalId}\n` +
    `포털에서 새 워크플로우를 시작하거나 담당 강사에게 문의하세요.`;

  // Slack 채널 알림 (추후 수강생 ID 기반 DM으로 확장 가능)
  await sendSystemAlert(message);
}
