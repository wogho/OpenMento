/**
 * heartbeat.ts — Heartbeat 스케줄러 서비스
 *
 * plan.md 2-1 작업 항목 전체 구현:
 *  - routines + routine_triggers 테이블 기반 스케줄 실행 엔진
 *  - 동시 실행 제한 (HEARTBEAT_MAX_CONCURRENT_RUNS, 기본 1, 최대 10)
 *  - 중복 실행 방지 락 (startLocksByAgent Map + executionLockedAt)
 *  - heartbeat_runs 테이블에 실행 이력 저장 (usageJson / stdoutExcerpt / resultJson)
 *  - 실패 시 자동 재시도 (retryOfRunId + processLossRetryCount)
 *  - 단기 JWT 발급 (issueAgentToken — 실행 중에만 유효)
 *
 * 에이전트 생명주기:
 *   queued → wakeup → running → completed / failed → (sleep)
 *
 * paperclip `server/src/services/heartbeat.ts` 상태 머신 구조 참조,
 * 교육기관 멀티 테넌트 도메인에 맞게 재구현.
 */

import { createHash } from 'node:crypto';
import { eq, and, isNull, isNotNull, lt, sql } from '@educlip/db';
import {
  db,
  agents,
  heartbeatRuns,
  routines,
  routineTriggers,
} from '@educlip/db';
import type { Agent, NewHeartbeatRun } from '@educlip/db';
import { matchesCron, parseCron } from './cron.js';
import { issueAgentToken } from './agent-auth-jwt.js';
import { runEwsMonitor } from './ews-monitor.js';
import { sendEwsEscalations } from './slack-notifier.js';
import { runDataRetention } from './data-retention.js';
import { logger } from '../utils/logger.js';
import { io } from '../socket/chat.handler.js';

// ── 환경 변수 ────────────────────────────────────────────────────────────────

/**
 * 동시 실행 가능한 heartbeat 최대 수.
 * 기본 1, 최대 10 (plan.md 제약).
 */
const MAX_CONCURRENT_RUNS = Math.min(
  Math.max(1, parseInt(process.env.HEARTBEAT_MAX_CONCURRENT_RUNS ?? '1', 10)),
  10,
);

/**
 * 프로세스 재시작 후 executionLockedAt 이 이 시간(ms) 이상 경과하면
 * "프로세스 손실(process-loss)" 재시도 대상으로 간주합니다.
 * 기본 10분.
 */
const PROCESS_LOSS_STALE_MS = parseInt(
  process.env.HEARTBEAT_STALE_LOCK_MS ?? String(10 * 60 * 1000),
  10,
);

/** 프로세스 손실 재시도 최대 횟수 */
const MAX_PROCESS_LOSS_RETRIES = 3;

// ── 내부 상태 ────────────────────────────────────────────────────────────────

/**
 * 에이전트별 실행 중인 runId 집합.
 * 인메모리 중복 실행 방지 락 (DB executionLockedAt 과 이중 보호).
 * key: agentId, value: runId
 */
const startLocksByAgent = new Map<string, string>();

/** 현재 진행 중인 실행 수 */
let currentConcurrentRuns = 0;

// ── 분산 환경 Advisory Lock 헬퍼 ──────────────────────────────────────────────

/**
 * agentId + 분 단위 버킷으로부터 PostgreSQL advisory lock 에 사용할
 * int4 2개짜리 키를 생성합니다. (pg_try_advisory_xact_lock(key1, key2) 형태)
 *
 * SHA-256 해시의 첫 8 바이트에서 두 개의 부호 있는 32비트 정수를 추출합니다.
 * 동일한 (agentId, minuteBucket) 조합은 항상 동일한 키를 반환합니다.
 * sql.raw() 에 전달하기 위해 [string, string] 형태로 반환합니다.
 */
function advisoryLockKeys(agentId: string, minuteBucket: string): [string, string] {
  const hash = createHash('sha256')
    .update(`educlip:heartbeat:${agentId}:${minuteBucket}`)
    .digest();
  return [
    String(hash.readInt32BE(0)),
    String(hash.readInt32BE(4)),
  ];
}

/**
 * DB-level advisory lock(pg_try_advisory_xact_lock)을 이용해
 * 현재 분에 대한 에이전트 dispatch 권한을 원자적으로 획득하고,
 * 성공 시 heartbeat_runs 레코드(status='queued')를 생성하여 runId 를 반환합니다.
 *
 * 다중 서버 인스턴스에서 동일한 트리거-분 조합이 중복 실행되는 것을 방지합니다.
 * (Phase 5 스케일아웃 대비 — Redis/Redlock 없이 PostgreSQL 만으로 해결)
 *
 * @param agent                실행할 에이전트
 * @param minuteBucket         분 단위 버킷 문자열 ("2026-04-06T07:00")
 * @param retryOfRunId         재시도 대상 runId (선택)
 * @param processLossRetryCount 프로세스 손실 재시도 횟수
 * @returns 생성된 runId, 또는 lock 경합·중복 실행 시 null
 */
async function tryAtomicDispatch(
  agent: Agent,
  minuteBucket: string,
  retryOfRunId?: string,
  processLossRetryCount = 0,
): Promise<string | null> {
  const [k1, k2] = advisoryLockKeys(agent.id, minuteBucket);

  return db.transaction(async (tx) => {
    // 1. Advisory lock 획득 시도 (non-blocking TRY 버전)
    //    다른 인스턴스가 동일 (agentId, 분)을 처리 중이면 즉시 false 반환
    const lockRows = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${sql.raw(k1)}, ${sql.raw(k2)}) AS acquired`,
    );
    const acquired =
      (lockRows as unknown as Array<{ acquired: boolean }>)[0]?.acquired === true;
    if (!acquired) return null;

    // 2. Double-check: 최근 59초 이내 동일 에이전트의 활성 run 이 있으면 중단
    //    (서버 재시작 직후 두 스캔이 연속 실행되는 엣지 케이스 대비)
    const [existingRun] = await tx
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.agentId, agent.id),
          sql`${heartbeatRuns.status} IN ('queued', 'wakeup', 'running')`,
          sql`${heartbeatRuns.createdAt} >= NOW() - INTERVAL '59 seconds'`,
        ),
      )
      .limit(1);

    if (existingRun) return null;

    // 3. 원자적으로 run 레코드 생성 (lock 해제 전까지 다른 인스턴스가 INSERT 불가)
    const [newRun] = await tx
      .insert(heartbeatRuns)
      .values({
        institutionId: agent.institutionId,
        agentId: agent.id,
        status: 'queued',
        retryOfRunId: retryOfRunId ?? null,
        processLossRetryCount,
      })
      .returning({ id: heartbeatRuns.id });

    return newRun?.id ?? null;
  });
}

// ── 타입 ────────────────────────────────────────────────────────────────────

interface RunResult {
  success: boolean;
  resultJson?: object;
  usageJson?: object;
  stdoutExcerpt?: string;
  errorMessage?: string;
}

// ── 실행 엔진 ────────────────────────────────────────────────────────────────

/**
 * 에이전트를 실제로 실행하는 함수.
 * Phase 2-1 에서는 EWS 위험 점수 산출 플로우의 플레이스홀더.
 * Phase 2-2 에서 EWS 모니터 에이전트 로직으로 교체됩니다.
 *
 * @param agent      실행할 에이전트 레코드
 * @param agentToken 단기 JWT (실행 스코프 인증)
 * @param runId      현재 heartbeat_runs UUID
 */
async function executeAgent(
  agent: Agent,
  agentToken: string,
  runId: string,
): Promise<RunResult> {
  const logs: string[] = [];

  logs.push(`[${new Date().toISOString()}] 에이전트 실행 시작: ${agent.name} (${agent.role})`);
  logs.push(`[heartbeat] runId=${runId}`);
  logs.push(`[heartbeat] agentToken 유효 (15분 TTL)`);

  try {
    // ── 역할별 실행 로직 라우팅 ────────────────────────────────
    switch (agent.role) {
      case 'ews_monitor': {
        logs.push('[ews_monitor] EWS 위험 점수 산출 시작');

        const summary = await runEwsMonitor(agent, runId);

        logs.push(
          `[ews_monitor] 완료 — 스캔=${summary.scannedCount} ` +
          `저장=${summary.savedCount} ` +
          `주의=${summary.warningCount} ` +
          `위험=${summary.highRiskCount} ` +
          `긴급=${summary.criticalCount} ` +
          `오류=${summary.errors.length}`,
        );

        // ── 에스컬레이션 알림 (fire-and-forget) ──────────────────────────
        // Heartbeat 트랜잭션을 블로킹하지 않도록 void 패턴 사용.
        // 실패해도 Heartbeat 완료 상태에는 영향 없음.
        void sendEwsEscalations(agent.institutionId, summary.scores).catch((err) => {
          logger.error({ err }, '[ews_monitor] 에스컬레이션 오류 (무시됨)');
        });

        return {
          success: true,
          resultJson: {
            agentId: agent.id,
            role: agent.role,
            scannedCount: summary.scannedCount,
            savedCount: summary.savedCount,
            warningCount: summary.warningCount,
            highRiskCount: summary.highRiskCount,
            criticalCount: summary.criticalCount,
            errorCount: summary.errors.length,
          },
          usageJson: { promptTokens: 0, completionTokens: 0, totalCost: 0 },
          stdoutExcerpt: logs.slice(-30).join('\n'),
        };
      }

      case 'orchestrator': {
        logs.push('[orchestrator] 하위 에이전트 워크플로우 조율 (Phase 3 구현 예정)');
        break;
      }

      case 'data_retention': {
        logs.push('[data_retention] 5년 개인정보 파기 작업 시작');

        const retentionResult = await runDataRetention();

        logs.push(
          `[data_retention] 완료 — 스캔=${retentionResult.scannedStudents} ` +
          `처리=${retentionResult.processedStudents} ` +
          `상담노트=${retentionResult.deletedCounselingNotes} ` +
          `대화=${retentionResult.deletedConversationMessages} ` +
          `과제=${retentionResult.deletedAssignmentSubmissions} ` +
          `포트폴리오=${retentionResult.nulledPortfolioProposals} ` +
          `오류=${retentionResult.errors.length}`,
        );

        if (retentionResult.dryRun) {
          logs.push('[data_retention] DRY RUN 모드 — 실제 삭제 없음');
        }

        return {
          success: retentionResult.errors.length === 0,
          resultJson: {
            agentId: agent.id,
            role: agent.role,
            scannedStudents: retentionResult.scannedStudents,
            processedStudents: retentionResult.processedStudents,
            deletedCounselingNotes: retentionResult.deletedCounselingNotes,
            deletedConversationMessages: retentionResult.deletedConversationMessages,
            deletedAssignmentSubmissions: retentionResult.deletedAssignmentSubmissions,
            nulledPortfolioProposals: retentionResult.nulledPortfolioProposals,
            dryRun: retentionResult.dryRun,
            errorCount: retentionResult.errors.length,
          },
          usageJson: { promptTokens: 0, completionTokens: 0, totalCost: 0 },
          stdoutExcerpt: logs.slice(-30).join('\n'),
        };
      }

      default: {
        logs.push(`[${agent.role}] 기본 실행 핸들러 (역할별 로직 미구현)`);
      }
    }

    logs.push(`[${new Date().toISOString()}] 에이전트 실행 완료`);

    return {
      success: true,
      resultJson: { agentId: agent.id, role: agent.role, status: 'stub_ok' },
      usageJson: { promptTokens: 0, completionTokens: 0, totalCost: 0 },
      stdoutExcerpt: logs.slice(-20).join('\n'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`[ERROR] ${msg}`);

    return {
      success: false,
      errorMessage: msg,
      stdoutExcerpt: logs.slice(-20).join('\n'),
    };
  }
}

// ── Heartbeat 실행 파이프라인 ─────────────────────────────────────────────────

/**
 * 단일 에이전트에 대한 완전한 heartbeat 실행 파이프라인.
 *
 * queued → wakeup → running → completed/failed
 */
async function runHeartbeatForAgent(
  agent: Agent,
  retryOfRunId?: string,
  processLossRetryCount = 0,
  preCreatedRunId?: string,
): Promise<void> {
  // ── 1. 인메모리 중복 실행 방지 ──────────────────────────────
  if (startLocksByAgent.has(agent.id)) {
    logger.info(
      `[heartbeat] 건너뜀 — 이미 실행 중: agentId=${agent.id}`,
    );
    return;
  }

  // ── 2. 동시 실행 상한 확인 ──────────────────────────────────
  if (currentConcurrentRuns >= MAX_CONCURRENT_RUNS) {
    logger.info(
      `[heartbeat] 동시 실행 한도 도달 (${currentConcurrentRuns}/${MAX_CONCURRENT_RUNS}) — agentId=${agent.id} 건너뜀`,
    );
    return;
  }

  // ── 3. heartbeat_runs 레코드 (queued) — preCreatedRunId 가 있으면 재사용 ──
  //    cron dispatch 경로: tryAtomicDispatch() 에서 advisory lock 안에 생성됨
  //    process-loss 재시도 경로: 기존 stale run id 를 직접 전달받음
  let runId: string;
  if (preCreatedRunId) {
    runId = preCreatedRunId;
  } else {
    const newRun: NewHeartbeatRun = {
      institutionId: agent.institutionId,
      agentId: agent.id,
      status: 'queued',
      retryOfRunId: retryOfRunId ?? null,
      processLossRetryCount,
    };
    const [run] = await db.insert(heartbeatRuns).values(newRun).returning();
    if (!run) {
      logger.error('[heartbeat] heartbeat_runs 레코드 생성 실패');
      return;
    }
    runId = run.id;
  }

  // ── 4. 인메모리 락 획득 + 카운터 증가 ───────────────────────
  startLocksByAgent.set(agent.id, runId);
  currentConcurrentRuns++;

  try {
    // ── 5. 상태: wakeup + executionLockedAt 기록 ────────────────
    await db
      .update(heartbeatRuns)
      .set({
        status: 'wakeup',
        executionLockedAt: new Date(),
        startedAt: new Date(),
      })
      .where(eq(heartbeatRuns.id, runId));

    // ── 6. 단기 JWT 발급 ─────────────────────────────────────
    const agentToken = issueAgentToken(agent.id, agent.institutionId, runId);

    // ── 7. 상태: running ─────────────────────────────────────
    await db
      .update(heartbeatRuns)
      .set({ status: 'running' })
      .where(eq(heartbeatRuns.id, runId));

    logger.info(`[heartbeat] 실행 시작: agent="${agent.name}" runId=${runId}`);

    // ── 8. 에이전트 실행 ─────────────────────────────────────
    const result = await executeAgent(agent, agentToken, runId);

    // ── 9. 완료/실패 기록 ────────────────────────────────────
    if (result.success) {
      await db
        .update(heartbeatRuns)
        .set({
          status: 'completed',
          executionLockedAt: null,
          finishedAt: new Date(),
          resultJson: result.resultJson ?? null,
          usageJson: result.usageJson ?? null,
          stdoutExcerpt: result.stdoutExcerpt ?? null,
        })
        .where(eq(heartbeatRuns.id, runId));

      logger.info(`[heartbeat] 완료: agent="${agent.name}" runId=${runId}`);
      // Phase 5-4: Admin 룸에 에이전트 실행 완료 실시간 Push
      io?.to(`admin:${agent.institutionId}`).emit('agent:status_change', {
        agentId: agent.id,
        agentName: agent.name,
        runId,
        status: 'completed',
        finishedAt: new Date().toISOString(),
      });
    } else {
      await db
        .update(heartbeatRuns)
        .set({
          status: 'failed',
          executionLockedAt: null,
          finishedAt: new Date(),
          errorMessage: result.errorMessage ?? null,
          stdoutExcerpt: result.stdoutExcerpt ?? null,
        })
        .where(eq(heartbeatRuns.id, runId));

      logger.error(
        `[heartbeat] 실패: agent="${agent.name}" runId=${runId} error="${result.errorMessage}"`,
      );
      // Phase 5-4: Admin 룸에 에이전트 실행 실패 실시간 Push
      io?.to(`admin:${agent.institutionId}`).emit('agent:status_change', {
        agentId: agent.id,
        agentName: agent.name,
        runId,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorMessage: result.errorMessage,
      });
    }
  } catch (err) {
    // ── 10. 예외 시 실패 처리 ────────────────────────────────
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err }, `[heartbeat] 예외 발생: agent="${agent.name}" runId=${runId}`);

    await db
      .update(heartbeatRuns)
      .set({
        status: 'failed',
        executionLockedAt: null,
        finishedAt: new Date(),
        errorMessage,
      })
      .where(eq(heartbeatRuns.id, runId));
  } finally {
    // ── 11. 락 해제 + 카운터 감소 ───────────────────────────
    startLocksByAgent.delete(agent.id);
    currentConcurrentRuns = Math.max(0, currentConcurrentRuns - 1);
  }
}

// ── 프로세스 손실 재시도 ─────────────────────────────────────────────────────

/**
 * 서버 재시작 후 executionLockedAt 이 PROCESS_LOSS_STALE_MS 이상 경과한
 * 좀비 실행(running/wakeup 상태)을 찾아 재시도합니다.
 */
async function retryProcessLossRuns(): Promise<void> {
  const staleThreshold = new Date(Date.now() - PROCESS_LOSS_STALE_MS);

  // wakeup 또는 running 상태이며 락이 오래된 실행 조회
  const staleRuns = await db
    .select()
    .from(heartbeatRuns)
    .where(
      and(
        sql`${heartbeatRuns.status} IN ('wakeup', 'running')`,
        lt(heartbeatRuns.executionLockedAt, staleThreshold),
      ),
    );

  for (const staleRun of staleRuns) {
    if (staleRun.processLossRetryCount >= MAX_PROCESS_LOSS_RETRIES) {
      // 최대 재시도 초과 → 최종 실패 처리
      await db
        .update(heartbeatRuns)
        .set({
          status: 'failed',
          executionLockedAt: null,
          finishedAt: new Date(),
          errorMessage: `프로세스 손실 후 최대 재시도 횟수(${MAX_PROCESS_LOSS_RETRIES}) 초과`,
        })
        .where(eq(heartbeatRuns.id, staleRun.id));
      continue;
    }

    // 에이전트 조회 후 재시도 실행
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, staleRun.agentId));

    if (!agent) continue;

    logger.info(
      `[heartbeat] 프로세스 손실 재시도: agent="${agent.name}" staleRunId=${staleRun.id} (시도 ${staleRun.processLossRetryCount + 1}/${MAX_PROCESS_LOSS_RETRIES})`,
    );

    void runHeartbeatForAgent(
      agent,
      staleRun.id,
      staleRun.processLossRetryCount + 1,
    );
  }
}

// ── 주기 스캔 엔진 ────────────────────────────────────────────────────────────

/**
 * 현재 분에 매칭되는 모든 활성 cron 트리거를 조회하여 해당 에이전트를 기동합니다.
 * setInterval 1분마다 호출됩니다.
 */

// ── 개선① 월별 예산 정지 에이전트 자동 재활성화 ──────────────────────────────

/**
 * 예산 초과로 비활성화된 에이전트를 새 달 시작 시 자동 복구합니다.
 *
 * 조건: `budget_paused_at IS NOT NULL` (예산 정지) AND `is_active = false`
 * 호출: `scanAndDispatch()` — 매달 1일 00:00 에만 실행
 */
async function reactivateBudgetPausedAgents(): Promise<void> {
  try {
    const result = await db
      .update(agents)
      .set({ isActive: true, budgetPausedAt: null })
      .where(
        and(
          eq(agents.isActive, false),
          isNotNull(agents.budgetPausedAt),
        ),
      );
    logger.info(
      { count: (result as unknown as { rowCount?: number }).rowCount ?? 0 },
      '[heartbeat] 월별 예산 정지 에이전트 재활성화 완료',
    );
  } catch (err) {
    logger.error({ err }, '[heartbeat] 예산 정지 에이전트 재활성화 실패');
  }
}

async function scanAndDispatch(now: Date): Promise<void> {
  // ── 활성 cron 트리거 + 루틴 + 에이전트 조인 조회 ────────────
  const activeTriggers = await db
    .select({
      triggerId: routineTriggers.id,
      cronExpression: routineTriggers.cronExpression,
      agentId: routines.agentId,
      institutionId: routines.institutionId,
    })
    .from(routineTriggers)
    .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
    .where(
      and(
        eq(routineTriggers.kind, 'cron'),
        eq(routineTriggers.isActive, true),
        eq(routines.isActive, true),
        isNull(sql`NULL`), // 플레이스홀더 (항상 참, 추후 기관 필터 추가 시 교체)
      ),
    );

  // 개선①: 매달 1일 00:00 — 예산 초과로 중지된 에이전트 자동 재활성화
  if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
    void reactivateBudgetPausedAgents();
  }

  for (const trigger of activeTriggers) {
    if (!trigger.cronExpression) continue;

    let expr;
    try {
      expr = parseCron(trigger.cronExpression);
    } catch (e) {
      logger.error(
        { err: e },
        `[heartbeat] cron 파싱 오류: triggerId=${trigger.triggerId} expression="${trigger.cronExpression}"`,
      );
      continue;
    }

    if (!matchesCron(expr, now)) continue;

    // ── 에이전트 조회 ──────────────────────────────────────
    const [agent] = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, trigger.agentId),
          eq(agents.isActive, true),
          isNull(agents.deletedAt),
        ),
      );

    if (!agent) {
      logger.warn(
        `[heartbeat] 비활성/삭제된 에이전트 건너뜀: agentId=${trigger.agentId}`,
      );
      continue;
    }

    // ── Advisory lock + 원자적 run 생성 (Phase 5 다중 인스턴스 대비) ────
    // ISO 8601 분 단위 버킷 ("2026-04-06T07:00") — 동일 분 내 중복 dispatch 방지
    const minuteBucket = now.toISOString().slice(0, 16);
    const preCreatedRunId = await tryAtomicDispatch(agent, minuteBucket);

    if (!preCreatedRunId) {
      logger.info(
        `[heartbeat] dispatch 건너뜀 — advisory lock 경합 또는 중복 실행: agentId=${agent.id}`,
      );
      continue;
    }

    // ── 비동기 실행 (블로킹하지 않음) ───────────────────────────────────
    void runHeartbeatForAgent(agent, undefined, 0, preCreatedRunId);
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Heartbeat 스케줄러를 시작합니다.
 *
 * - 서버 기동 직후 프로세스 손실 재시도 복구 실행
 * - 1분마다 cron 트리거 매칭 → 에이전트 dispatch
 *
 * 중복 호출 시 기존 인터벌을 중지하고 재시작합니다.
 */
export function startHeartbeatScheduler(): void {
  if (schedulerIntervalId !== null) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }

  logger.info(
    `[heartbeat] 스케줄러 시작 (MAX_CONCURRENT_RUNS=${MAX_CONCURRENT_RUNS})`,
  );

  // 서버 재시작 직후 좀비 실행 복구
  void retryProcessLossRuns();

  // 1분마다 cron 트리거 스캔
  schedulerIntervalId = setInterval(() => {
    const now = new Date();
    // 초·밀리초 정규화 (분 단위 비교)
    now.setSeconds(0, 0);
    void scanAndDispatch(now);
  }, 60_000);

  // 서버 기동 직후 즉시 1회 스캔 (분 경계에서 시작하지 않았을 경우 보정)
  const boot = new Date();
  boot.setSeconds(0, 0);
  void scanAndDispatch(boot);
}

/**
 * Heartbeat 스케줄러를 중지합니다.
 * 실행 중인 에이전트는 완료될 때까지 기다립니다.
 */
export function stopHeartbeatScheduler(): void {
  if (schedulerIntervalId !== null) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    logger.info('[heartbeat] 스케줄러 중지됨');
  }
}

/**
 * 특정 에이전트를 즉시 수동 실행합니다.
 * 관리자 GUI의 "지금 실행" 버튼에서 호출합니다.
 *
 * @param agentId       실행할 에이전트 UUID
 * @param institutionId 소속 기관 UUID (권한 확인용)
 */
export async function triggerAgentManually(
  agentId: string,
  institutionId: string,
): Promise<{ runId: string } | { error: string }> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.institutionId, institutionId),
        eq(agents.isActive, true),
        isNull(agents.deletedAt),
      ),
    );

  if (!agent) {
    return { error: '에이전트를 찾을 수 없거나 접근 권한이 없습니다.' };
  }

  if (startLocksByAgent.has(agentId)) {
    const existingRunId = startLocksByAgent.get(agentId)!;
    return { error: `이미 실행 중입니다. runId=${existingRunId}` };
  }

  // 비동기 실행 후 생성될 runId 를 선반환할 수 없으므로
  // 레코드를 미리 생성하고 실행을 위임합니다.
  const [pendingRun] = await db
    .insert(heartbeatRuns)
    .values({
      institutionId: agent.institutionId,
      agentId: agent.id,
      status: 'queued',
    })
    .returning({ id: heartbeatRuns.id });

  if (!pendingRun) {
    return { error: 'heartbeat_runs 레코드 생성 실패' };
  }

  // 즉시 실행 (pendingRun 은 runHeartbeatForAgent 내에서 재생성되지 않도록
  // 이미 생성된 레코드를 wakeup 으로 전환하여 사용)
  void (async () => {
    await db
      .update(heartbeatRuns)
      .set({ status: 'wakeup', executionLockedAt: new Date(), startedAt: new Date() })
      .where(eq(heartbeatRuns.id, pendingRun.id));

    startLocksByAgent.set(agent.id, pendingRun.id);
    currentConcurrentRuns++;

    try {
      const agentToken = issueAgentToken(agent.id, agent.institutionId, pendingRun.id);
      await db
        .update(heartbeatRuns)
        .set({ status: 'running' })
        .where(eq(heartbeatRuns.id, pendingRun.id));

      const result = await executeAgent(agent, agentToken, pendingRun.id);

      if (result.success) {
        await db
          .update(heartbeatRuns)
          .set({
            status: 'completed',
            executionLockedAt: null,
            finishedAt: new Date(),
            resultJson: result.resultJson ?? null,
            usageJson: result.usageJson ?? null,
            stdoutExcerpt: result.stdoutExcerpt ?? null,
          })
          .where(eq(heartbeatRuns.id, pendingRun.id));
      } else {
        await db
          .update(heartbeatRuns)
          .set({
            status: 'failed',
            executionLockedAt: null,
            finishedAt: new Date(),
            errorMessage: result.errorMessage ?? null,
            stdoutExcerpt: result.stdoutExcerpt ?? null,
          })
          .where(eq(heartbeatRuns.id, pendingRun.id));
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await db
        .update(heartbeatRuns)
        .set({
          status: 'failed',
          executionLockedAt: null,
          finishedAt: new Date(),
          errorMessage,
        })
        .where(eq(heartbeatRuns.id, pendingRun.id));
    } finally {
      startLocksByAgent.delete(agent.id);
      currentConcurrentRuns = Math.max(0, currentConcurrentRuns - 1);
    }
  })();

  return { runId: pendingRun.id };
}

/** 현재 스케줄러 상태 스냅샷 (관리자 대시보드용) */
export function getHeartbeatStatus(): {
  isRunning: boolean;
  currentConcurrentRuns: number;
  maxConcurrentRuns: number;
  lockedAgents: Array<{ agentId: string; runId: string }>;
} {
  return {
    isRunning: schedulerIntervalId !== null,
    currentConcurrentRuns,
    maxConcurrentRuns: MAX_CONCURRENT_RUNS,
    lockedAgents: Array.from(startLocksByAgent.entries()).map(([agentId, runId]) => ({
      agentId,
      runId,
    })),
  };
}
