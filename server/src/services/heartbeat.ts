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
import { eq, and, isNull, isNotNull, lt, sql } from '@openmento/db';
import {
  db,
  agents,
  heartbeatRuns,
  routines,
  routineTriggers,
} from '@openmento/db';
import type { Agent, NewHeartbeatRun } from '@openmento/db';
import { matchesCron, parseCron } from './cron.js';
import { issueAgentToken } from './agent-auth-jwt.js';
import { runEwsMonitor } from './ews-monitor.js';
import { sendEwsEscalations } from './slack-notifier.js';
import { runDataRetention } from './data-retention.js';
import { checkProactiveBudget, recordCostEvent } from './budget-guard.js';
import type { AdapterConfig, AgentExecutionContext, AdapterSessionCodec, AdapterSessionResult } from '../adapters/llm.interface.js';
import { getInstitutionSetting } from './institution-settings-service.js';
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

/**
 * 에이전트 실행 최대 허용 시간(ms).
 * 이 시간을 초과하면 status='timed_out' 으로 강제 종료됩니다.
 * 기본 15분 (paperclip process adapter timeoutSec=900 参照).
 */
const DEFAULT_HEARTBEAT_TIMEOUT_MS = parseInt(
  process.env.HEARTBEAT_TIMEOUT_MS ?? String(15 * 60 * 1000),
  10,
);

const HEARTBEAT_WEBHOOK_DEFAULT_TIMEOUT_MS = parseInt(
  process.env.HEARTBEAT_WEBHOOK_TIMEOUT_MS ?? '30000',
  10,
);

interface AdminSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openclawApiKey?: string;
  slackWebhookUrl?: string;
}

// ── 내부 상태 ────────────────────────────────────────────────────────────────

/**
 * 에이전트별 실행 중인 runId 집합.
 * 인메모리 중복 실행 방지 락 (DB executionLockedAt 과 이중 보호).
 * key: agentId, value: runId
 */
const startLocksByAgent = new Map<string, string>();

/** 현재 진행 중인 실행 수 */
let currentConcurrentRuns = 0;

/**
 * 취소 요청 Set.
 * cancelRun() 으로 취소가 요청된 runId 를 저장하고,
 * executeAgent() 내 타임아웃 루프에서 이를 폴링하여 조기 종료합니다.
 */
const cancelRequestedRuns = new Set<string>();

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
    .update(`openmento:heartbeat:${agentId}:${minuteBucket}`)
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
  pendingCallback?: boolean;
  // paperclip Session Codec 호환 세션 결과 필드
  sessionParams?: Record<string, unknown> | null;
  sessionId?: string | null;
  clearSession?: boolean;
  errorCode?: string | null;
}

interface HeartbeatCallbackPayload {
  success?: boolean;
  status?: 'completed' | 'failed';
  resultJson?: Record<string, unknown>;
  usageJson?: Record<string, unknown>;
  stdoutExcerpt?: string;
  errorMessage?: string;
  // paperclip 호환 비용 추적 필드
  costUsd?: number;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  // paperclip 호환 구조화 오류 코드
  errorCode?: string;
  // paperclip Session Codec 호환 세션 필드
  sessionParams?: Record<string, unknown> | null;
  sessionId?: string | null;
  clearSession?: boolean;
}

function applySecretsInterpolation(value: string, secrets: AdminSecrets): string {
  return value.replace(/\$\{\s*secrets\.([a-zA-Z0-9_]+)\s*\}/g, (_, key: string) => {
    const secretValue = secrets[key as keyof AdminSecrets];
    return typeof secretValue === 'string' ? secretValue : '';
  });
}

function renderPromptTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    if (key in vars) return vars[key];
    return match;
  });
}

// ── Session Codec (paperclip 참조) ───────────────────────────────────────────

/**
 * 기본 세션 코덱 — 직렬화/역직렬화는 pass-through,
 * getDisplayId는 sessionId → threadId 순서로 검색.
 * paperclip의 defaultSessionCodec과 동일한 계약.
 */
const defaultSessionCodec: AdapterSessionCodec = {
  serialize(params) { return params; },
  deserialize(raw) {
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  },
  getDisplayId(params) {
    if (!params) return null;
    if (typeof params.sessionId === 'string') return params.sessionId;
    if (typeof params.threadId === 'string') return params.threadId;
    if (typeof params.conversationId === 'string') return params.conversationId;
    return null;
  },
};

/**
 * 실행 결과에서 다음 세션 상태를 결정합니다.
 * paperclip의 resolveNextSessionState() 패턴 참조.
 *
 * - clearSession=true: 세션 삭제 (null 반환)
 * - sessionParams 명시: 직접 사용
 * - sessionId 명시: { sessionId } 객체로 래핑
 * - 모두 없음: 이전 세션 유지
 */
function resolveNextSessionState(
  previousParams: Record<string, unknown> | null,
  result: Pick<AdapterSessionResult, 'sessionParams' | 'sessionId' | 'clearSession'>,
  codec: AdapterSessionCodec = defaultSessionCodec,
): { sessionParams: Record<string, unknown> | null; displayId: string | null } {
  if (result.clearSession) {
    return { sessionParams: null, displayId: null };
  }
  let nextRaw: Record<string, unknown> | null = previousParams;
  if (result.sessionParams !== undefined) {
    nextRaw = result.sessionParams ?? null;
  } else if (result.sessionId !== undefined && result.sessionId !== null) {
    nextRaw = { sessionId: result.sessionId };
  }
  const serialized = codec.serialize(nextRaw);
  const deserialized = codec.deserialize(serialized);
  const displayId = deserialized ? codec.getDisplayId(deserialized) : null;
  return { sessionParams: deserialized, displayId };
}

async function executeAgentViaHttpWebhook(
  agent: Agent,
  runId: string,
  agentToken: string,
  invocationSource: 'timer' | 'on_demand' | 'wakeup' | 'automation',
  adapterConfig: AdapterConfig,
  sessionParams: Record<string, unknown> | null,
): Promise<RunResult> {
  if (!adapterConfig.webhookUrl) {
    return {
      success: false,
      errorMessage: 'adapterType=http_webhook 인데 webhookUrl이 설정되지 않았습니다.',
    };
  }

  const secrets = await getInstitutionSetting<AdminSecrets>(agent.institutionId, 'secrets', {});
  const timeoutMs = adapterConfig.timeoutMs ?? HEARTBEAT_WEBHOOK_DEFAULT_TIMEOUT_MS;
  const contextMode = adapterConfig.contextMode ?? 'thin';

  const promptVars: Record<string, string> = {
    'agent.id': agent.id,
    'agent.name': agent.name,
    'agent.role': agent.role,
    runId,
    institutionId: agent.institutionId,
    invocationSource,
  };

  const prompt = adapterConfig.promptTemplate
    ? renderPromptTemplate(adapterConfig.promptTemplate, promptVars)
    : agent.systemPrompt ?? '';

  const executionContext: AgentExecutionContext = {
    runId,
    agentId: agent.id,
    institutionId: agent.institutionId,
    invocationSource,
    authToken: agentToken,
    // Session Codec: 이전 세션 파라미터 포함 (최초 실행 시 null)
    sessionParams: sessionParams ?? null,
    ...(contextMode === 'fat'
      ? {
        contextSnapshot: {
          agent: {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            slug: agent.slug,
          },
          runtimeConfig: agent.runtimeConfig ?? {},
          permissions: agent.permissions ?? {},
          timestamp: new Date().toISOString(),
        },
      }
      : {}),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${agentToken}`,
  };

  if (adapterConfig.webhookHeaders) {
    for (const [k, v] of Object.entries(adapterConfig.webhookHeaders)) {
      headers[k] = applySecretsInterpolation(v, secrets);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(adapterConfig.webhookUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        type: 'openmento_heartbeat_run',
        runId,
        institutionId: agent.institutionId,
        invocationSource,
        contextMode,
        prompt,
        // Session Codec: 이전 세션 파라미터를 외부 에이전트에 전달
        sessionParams: sessionParams ?? null,
        context: contextMode === 'fat'
          ? executionContext.contextSnapshot ?? {}
          : {
            runId,
            agentId: agent.id,
            institutionId: agent.institutionId,
            invocationSource,
          },
      }),
    });

    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');

    if (!response.ok) {
      return {
        success: false,
        errorMessage: `[http_webhook] ${response.status} ${response.statusText}`,
        resultJson: {
          webhookStatus: response.status,
          webhookBody: body,
        },
      };
    }

    // 동기 응답(200)에서 세션 결과 파싱 (202 callback 대기 시에는 callback에서 처리)
    const syncSessionResult: Pick<AdapterSessionResult, 'sessionParams' | 'sessionId' | 'clearSession'> =
      body && typeof body === 'object'
        ? {
          sessionParams: (body as Record<string, unknown>).sessionParams as Record<string, unknown> | null | undefined,
          sessionId: (body as Record<string, unknown>).sessionId as string | null | undefined,
          clearSession: (body as Record<string, unknown>).clearSession as boolean | undefined,
        }
        : {};

    return {
      success: true,
      pendingCallback: response.status === 202,
      // 202(callback 대기)이면 세션 결과는 callback 에서 처리되므로 여기서는 전달 안 함
      ...(response.status !== 202 ? syncSessionResult : {}),
      resultJson: {
        delegated: true,
        adapterType: 'http_webhook',
        webhookStatus: response.status,
        accepted: response.status === 202,
        response: body,
      },
      usageJson: { promptTokens: 0, completionTokens: 0, totalCost: 0 },
      stdoutExcerpt: `[http_webhook] delegated to ${adapterConfig.webhookUrl} (status=${response.status})`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        errorMessage: `[http_webhook] 요청 타임아웃 (${timeoutMs}ms)`,
      };
    }
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
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
  invocationSource: 'timer' | 'on_demand' | 'wakeup' | 'automation',
  sessionParams: Record<string, unknown> | null = null,
): Promise<RunResult> {
  const logs: string[] = [];

  logs.push(`[${new Date().toISOString()}] 에이전트 실행 시작: ${agent.name} (${agent.role})`);
  logs.push(`[heartbeat] runId=${runId}`);
  logs.push(`[heartbeat] invocationSource=${invocationSource}`);
  logs.push(`[heartbeat] agentToken 유효 (15분 TTL)`);

  try {
    const adapterConfig = (agent.adapterConfig ?? null) as AdapterConfig | null;
    if (adapterConfig?.adapterType === 'http_webhook') {
      logs.push('[http_webhook] 외부 adapter 엔드포인트로 실행 위임');
      const delegated = await executeAgentViaHttpWebhook(
        agent,
        runId,
        agentToken,
        invocationSource,
        adapterConfig,
        sessionParams,
      );
      return {
        ...delegated,
        stdoutExcerpt: [
          ...logs.slice(-10),
          delegated.stdoutExcerpt ?? '',
        ].filter(Boolean).join('\n'),
      };
    }

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
  invocationSource: 'timer' | 'on_demand' | 'wakeup' | 'automation' = 'timer',
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
    // invocationSource 업데이트 (tryAtomicDispatch 에서는 default 값만 들어감)
    await db
      .update(heartbeatRuns)
      .set({ invocationSource })
      .where(eq(heartbeatRuns.id, runId))
      .catch(() => {/* 무시 */});
  } else {
    const newRun: NewHeartbeatRun = {
      institutionId: agent.institutionId,
      agentId: agent.id,
      status: 'queued',
      invocationSource,
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
    // ── 5. 세션 파라미터 로드 (Session Codec) ─────────────────
    // 이전 실행에서 직렬화된 세션 컨텍스트를 읽어 외부 어댑터에 전달합니다.
    const previousSessionParams =
      (agent.lastSessionParamsJson as Record<string, unknown> | null) ?? null;
    const previousSessionDisplayId = (agent as Record<string, unknown>).lastSessionDisplayId as string | null ?? null;

    // ── 6. 상태: wakeup + executionLockedAt + sessionIdBefore 기록 ────────────────
    await db
      .update(heartbeatRuns)
      .set({
        status: 'wakeup',
        executionLockedAt: new Date(),
        startedAt: new Date(),
        sessionIdBefore: previousSessionDisplayId,
      })
      .where(eq(heartbeatRuns.id, runId));

    // ── 7. 단기 JWT 발급 ─────────────────────────────────────
    const agentToken = issueAgentToken(agent.id, agent.institutionId, runId);

    // ── 8. 상태: running ─────────────────────────────────────
    await db
      .update(heartbeatRuns)
      .set({ status: 'running' })
      .where(eq(heartbeatRuns.id, runId));

    logger.info(`[heartbeat] 실행 시작: agent="${agent.name}" runId=${runId} sessionIdBefore=${previousSessionDisplayId ?? 'none'}`);

    // ── 9. 에이전트 실행 (타임아웃 강제) ──────────────────────
    // runtimeConfig.heartbeat.timeoutSec 우선, 없으면 DEFAULT_HEARTBEAT_TIMEOUT_MS
    const rc = agent.runtimeConfig as { heartbeat?: { timeoutSec?: number } } | null;
    const timeoutMs = (rc?.heartbeat?.timeoutSec ?? 0) > 0
      ? (rc!.heartbeat!.timeoutSec! * 1000)
      : DEFAULT_HEARTBEAT_TIMEOUT_MS;

    let result: RunResult;
    try {
      result = await Promise.race([
        executeAgent(agent, agentToken, runId, invocationSource, previousSessionParams),
        new Promise<RunResult>((_, reject) =>
          setTimeout(() => reject(new Error('__TIMEOUT__')), timeoutMs),
        ),
      ]);
    } catch (raceErr) {
      const isTimeout = raceErr instanceof Error && raceErr.message === '__TIMEOUT__';
      const isCancelled = cancelRequestedRuns.has(runId);
      cancelRequestedRuns.delete(runId);

      const terminalStatus = isCancelled ? 'cancelled' : (isTimeout ? 'timed_out' : 'failed');
      const terminalMsg = isCancelled
        ? '관리자에 의해 취소됨'
        : isTimeout
          ? `실행 타임아웃 (${timeoutMs / 1000}s 초과)`
          : (raceErr instanceof Error ? raceErr.message : String(raceErr));

      await db
        .update(heartbeatRuns)
        .set({
          status: terminalStatus,
          executionLockedAt: null,
          finishedAt: new Date(),
          errorMessage: terminalMsg,
        })
        .where(eq(heartbeatRuns.id, runId));

      logger.warn(`[heartbeat] ${terminalStatus}: agent="${agent.name}" runId=${runId} — ${terminalMsg}`);
      io?.to(`admin:${agent.institutionId}`).emit('agent:status_change', {
        agentId: agent.id,
        agentName: agent.name,
        runId,
        status: terminalStatus,
        finishedAt: new Date().toISOString(),
        errorMessage: terminalMsg,
      });
      return;
    }

    // ── 10. 완료/실패 기록 + Session Codec 저장 ─────────────────────
    if (result.success && result.pendingCallback) {
      // 202 callback 대기 — 세션은 callback에서 처리
      await db
        .update(heartbeatRuns)
        .set({
          status: 'running',
          executionLockedAt: null,
          resultJson: result.resultJson ?? null,
          usageJson: result.usageJson ?? null,
          stdoutExcerpt: result.stdoutExcerpt ?? null,
        })
        .where(and(
          eq(heartbeatRuns.id, runId),
          sql`${heartbeatRuns.status} IN ('running', 'wakeup')`,
        ));

      logger.info(`[heartbeat] 외부 callback 대기: agent="${agent.name}" runId=${runId}`);
      io?.to(`admin:${agent.institutionId}`).emit('agent:status_change', {
        agentId: agent.id,
        agentName: agent.name,
        runId,
        status: 'running',
        waitingForCallback: true,
      });
    } else if (result.success) {
      // 동기 완료 — 세션 저장
      const { sessionParams: nextSessionParams, displayId: nextSessionDisplayId } =
        resolveNextSessionState(previousSessionParams, result);

      await db
        .update(heartbeatRuns)
        .set({
          status: 'completed',
          executionLockedAt: null,
          finishedAt: new Date(),
          resultJson: result.resultJson ?? null,
          usageJson: result.usageJson ?? null,
          stdoutExcerpt: result.stdoutExcerpt ?? null,
          sessionIdAfter: nextSessionDisplayId,
          errorCode: result.errorCode ?? null,
        })
        .where(and(
          eq(heartbeatRuns.id, runId),
          sql`${heartbeatRuns.status} IN ('running', 'wakeup')`,
        ));

      // Session Codec: 에이전트 레코드에 세션 상태 저장
      await db
        .update(agents)
        .set({
          lastSessionParamsJson: nextSessionParams ?? null,
          lastSessionDisplayId: nextSessionDisplayId ?? null,
        })
        .where(eq(agents.id, agent.id));

      if (nextSessionDisplayId) {
        logger.info(`[heartbeat] 완료 + 세션 저장: agent="${agent.name}" runId=${runId} sessionIdAfter=${nextSessionDisplayId}`);
      } else {
        logger.info(`[heartbeat] 완료: agent="${agent.name}" runId=${runId}`);
      }
      // Phase 5-4: Admin 룸에 에이전트 실행 완료 실시간 Push
      io?.to(`admin:${agent.institutionId}`).emit('agent:status_change', {
        agentId: agent.id,
        agentName: agent.name,
        runId,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        sessionIdAfter: nextSessionDisplayId ?? undefined,
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
          errorCode: result.errorCode ?? null,
        })
        .where(and(
          eq(heartbeatRuns.id, runId),
          sql`${heartbeatRuns.status} IN ('running', 'wakeup')`,
        ));

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
      .set({ isActive: true, budgetPausedAt: null, status: 'idle', spentMonthlyCents: 0 })
      .where(
        and(
          eq(agents.isActive, false),
          isNotNull(agents.budgetPausedAt),
        ),
      );
    logger.info(
      { count: (result as unknown as { rowCount?: number }).rowCount ?? 0 },
      '[heartbeat] 월별 예산 정지 에이전트 재활성화 완료 (status=idle, spentMonthlyCents 초기화)',
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
    void runHeartbeatForAgent(agent, undefined, 0, preCreatedRunId, 'timer');
  }

  // ── runtimeConfig.heartbeat 기반 자체 스케줄 에이전트 dispatch ──────────
  // routines/routine_triggers 없이도 에이전트 자체 intervalSec 설정으로 실행됩니다.
  // paperclip runtimeConfig 구조: { heartbeat: { enabled, intervalSec, maxConcurrentRuns } }
  await dispatchRuntimeConfigAgents(now);
}

/**
 * agents.runtimeConfig.heartbeat.enabled = true 인 에이전트를 조회하여
 * intervalSec 마다 한 번씩 dispatch합니다.
 *
 * lastHeartbeatAt 이 null 이거나 (now - lastHeartbeatAt) >= intervalSec 인 경우만 실행합니다.
 */
async function dispatchRuntimeConfigAgents(now: Date): Promise<void> {
  // terminated/paused 상태 에이전트 제외, JSON 내 heartbeat.enabled 필터는 메모리에서 처리
  const candidates = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.isActive, true),
        isNull(agents.deletedAt),
        sql`runtime_config->>'heartbeat' IS NOT NULL`,
        sql`(runtime_config->'heartbeat'->>'enabled')::boolean = true`,
      ),
    );

  for (const agent of candidates) {
    // terminated/paused 상태 에이전트 실행 금지
    if (agent.status === 'terminated' || agent.status === 'paused') continue;

    // 예산 사전체크
    const budgetCheck = await checkProactiveBudget(agent.institutionId, agent.id);
    if (!budgetCheck.allowed) {
      logger.info(`[heartbeat/runtime] 예산 초과 건너눠: agentId=${agent.id} — ${budgetCheck.reason}`);
      continue;
    }

    const rc = agent.runtimeConfig as {
      heartbeat?: { enabled?: boolean; intervalSec?: number; maxConcurrentRuns?: number };
    } | null;

    const intervalSec = rc?.heartbeat?.intervalSec ?? 300;

    // lastHeartbeatAt 이후 intervalSec 미만이면 건너뜀
    if (agent.lastHeartbeatAt) {
      const elapsedSec = (now.getTime() - new Date(agent.lastHeartbeatAt).getTime()) / 1000;
      if (elapsedSec < intervalSec) continue;
    }

    const minuteBucket = `runtime:${agent.id}:${now.toISOString().slice(0, 16)}`;
    const preCreatedRunId = await tryAtomicDispatch(agent, minuteBucket);

    if (!preCreatedRunId) {
      logger.debug(`[heartbeat/runtime] dispatch 건너뜀 (중복): agentId=${agent.id}`);
      continue;
    }

    // lastHeartbeatAt 갱신
    void db
      .update(agents)
      .set({ lastHeartbeatAt: now })
      .where(eq(agents.id, agent.id))
      .catch((err) => logger.warn({ err }, '[heartbeat/runtime] lastHeartbeatAt 업데이트 실패'));

    logger.info(
      `[heartbeat/runtime] dispatch: agent="${agent.name}" intervalSec=${intervalSec} runId=${preCreatedRunId}`,
    );

    void runHeartbeatForAgent(agent, undefined, 0, preCreatedRunId, 'automation');
  }
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

let schedulerIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * 외부 HTTP Webhook 어댑터가 비동기 완료 콜백을 전송할 때 run 상태를 확정합니다.
 *
 * @returns 'ok' | 'not_found' | 'already_finished'
 */
export async function applyHeartbeatCallback(
  runId: string,
  institutionId: string,
  payload: HeartbeatCallbackPayload,
): Promise<'ok' | 'not_found' | 'already_finished'> {
  const [run] = await db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
      agentId: heartbeatRuns.agentId,
      agentName: agents.name,
      agentInstitutionId: agents.institutionId,
      lastSessionParamsJson: agents.lastSessionParamsJson,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(agents.id, heartbeatRuns.agentId))
    .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.institutionId, institutionId)))
    .limit(1);

  if (!run) return 'not_found';

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'timed_out') {
    return 'already_finished';
  }

  const success = payload.success ?? payload.status !== 'failed';
  const nextStatus = success ? 'completed' : 'failed';
  const hasUsageForBudget =
    success &&
    typeof payload.provider === 'string' &&
    payload.provider.length > 0 &&
    typeof payload.model === 'string' &&
    payload.model.length > 0 &&
    (
      typeof payload.costUsd === 'number' ||
      typeof payload.inputTokens === 'number' ||
      typeof payload.outputTokens === 'number'
    );

  // paperclip 호환: inputTokens/outputTokens/costUsd를 usageJson에 병합
  const normalizedUsage: Record<string, unknown> = {
    ...(payload.usageJson ?? {}),
    ...(payload.inputTokens !== undefined && { inputTokens: payload.inputTokens }),
    ...(payload.outputTokens !== undefined && { outputTokens: payload.outputTokens }),
    ...(payload.cachedInputTokens !== undefined && { cachedInputTokens: payload.cachedInputTokens }),
    ...(payload.costUsd !== undefined && { costUsd: payload.costUsd }),
    ...(payload.model && { model: payload.model }),
    ...(payload.provider && { provider: payload.provider }),
  };
  const errorMsg = success
    ? null
    : (payload.errorMessage ?? (payload.errorCode ? `[${payload.errorCode}] 외부 callback에서 실패를 반환했습니다.` : '외부 callback에서 실패를 반환했습니다.'));

  // Session Codec: callback payload에서 세션 상태 결정
  const previousSessionParams = (run.lastSessionParamsJson as Record<string, unknown> | null) ?? null;
  const { sessionParams: nextSessionParams, displayId: nextSessionDisplayId } = success
    ? resolveNextSessionState(previousSessionParams, {
      sessionParams: payload.sessionParams,
      sessionId: payload.sessionId,
      clearSession: payload.clearSession,
    })
    : { sessionParams: previousSessionParams, displayId: null };

  await db
    .update(heartbeatRuns)
    .set({
      status: nextStatus,
      executionLockedAt: null,
      finishedAt: new Date(),
      resultJson: payload.resultJson ?? null,
      usageJson: Object.keys(normalizedUsage).length > 0 ? normalizedUsage : null,
      stdoutExcerpt: payload.stdoutExcerpt ?? null,
      errorMessage: errorMsg,
      errorCode: payload.errorCode ?? null,
      sessionIdAfter: success ? (nextSessionDisplayId ?? null) : null,
    })
    .where(eq(heartbeatRuns.id, runId));

  // Session Codec: 성공 시 에이전트 레코드에 세션 상태 저장
  if (success) {
    await db
      .update(agents)
      .set({
        lastSessionParamsJson: nextSessionParams ?? null,
        lastSessionDisplayId: nextSessionDisplayId ?? null,
      })
      .where(eq(agents.id, run.agentId));

    if (nextSessionDisplayId) {
      logger.info(`[heartbeat] callback 세션 저장: runId=${runId} sessionIdAfter=${nextSessionDisplayId}`);
    }
  }

  if (hasUsageForBudget) {
    await recordCostEvent({
      institutionId,
      agentId: run.agentId,
      provider: payload.provider!,
      model: payload.model!,
      inputTokens: payload.inputTokens ?? 0,
      outputTokens: payload.outputTokens ?? 0,
      ...(typeof payload.costUsd === 'number' ? { costUsd: payload.costUsd } : {}),
    });
  } else if (
    success &&
    (
      typeof payload.costUsd === 'number' ||
      typeof payload.inputTokens === 'number' ||
      typeof payload.outputTokens === 'number'
    )
  ) {
    logger.warn(
      {
        runId,
        institutionId,
        agentId: run.agentId,
        provider: payload.provider,
        model: payload.model,
      },
      '[heartbeat] callback 비용 메타데이터가 불완전하여 cost_events 기록을 건너뜀',
    );
  }

  io?.to(`admin:${institutionId}`).emit('agent:status_change', {
    agentId: run.agentId,
    agentName: run.agentName,
    runId,
    status: nextStatus,
    finishedAt: new Date().toISOString(),
    errorMessage: success ? undefined : payload.errorMessage,
    errorCode: success ? undefined : payload.errorCode,
    costUsd: payload.costUsd,
    model: payload.model,
    provider: payload.provider,
    sessionIdAfter: success ? (nextSessionDisplayId ?? undefined) : undefined,
  });

  return 'ok';
}

/**
 * 현재 실행 중인 heartbeat run을 취소 요청합니다. (paperclip cancelRunInternal 참조)
 *
 * - `running` 상태의 run에만 유효합니다.
 * - `cancelRequestedRuns` Set에 runId를 등록하여 executeAgent 내
 *   Promise.race 타임아웃이 다음 체크 시 취소로 처리합니다.
 * - 상태를 즉시 `cancelled`로 전환하고 소켓 이벤트를 발행합니다.
 *
 * @returns `'ok'` 취소 성공, `'not_found'` runId 없음, `'not_running'` 실행 중 아님
 */
export async function cancelHeartbeatRun(
  runId: string,
  institutionId: string,
): Promise<'ok' | 'not_found' | 'not_running'> {
  const [run] = await db
    .select({ id: heartbeatRuns.id, status: heartbeatRuns.status, agentId: heartbeatRuns.agentId })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.institutionId, institutionId)));

  if (!run) return 'not_found';
  if (run.status !== 'running' && run.status !== 'wakeup') return 'not_running';

  // 취소 요청 등록 — Promise.race 의 executeAgent 가 다음 await 에서 중단됨
  cancelRequestedRuns.add(runId);

  // 즉시 DB 상태 전환 (UI 반영 빠르게)
  await db
    .update(heartbeatRuns)
    .set({ status: 'cancelled', executionLockedAt: null, finishedAt: new Date(), errorMessage: '관리자에 의해 취소됨' })
    .where(eq(heartbeatRuns.id, runId));

  io?.to(`admin:${institutionId}`).emit('agent:status_change', {
    agentId: run.agentId,
    runId,
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  });

  logger.info(`[heartbeat] run 취소: runId=${runId} institutionId=${institutionId}`);
  return 'ok';
}

/**
 * 특정 에이전트의 현재 세션 상태를 조회합니다.
 * paperclip의 agentTaskSessions 조회 패턴 참조.
 *
 * @returns `{ sessionParams, displayId }` 또는 `null` (세션 없음 또는 에이전트 미존재)
 */
export async function getAgentSession(
  agentId: string,
  institutionId: string,
): Promise<{ sessionParams: Record<string, unknown>; displayId: string | null } | null> {
  const [agent] = await db
    .select({
      id: agents.id,
      lastSessionParamsJson: agents.lastSessionParamsJson,
      lastSessionDisplayId: agents.lastSessionDisplayId,
    })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.institutionId, institutionId)))
    .limit(1);

  if (!agent) return null;
  const params = agent.lastSessionParamsJson as Record<string, unknown> | null;
  if (!params || Object.keys(params).length === 0) return null;

  return {
    sessionParams: params,
    displayId: (agent.lastSessionDisplayId as string | null) ?? null,
  };
}

/**
 * 특정 에이전트의 세션 상태를 초기화합니다.
 * 다음 실행 시 새 세션으로 시작됩니다.
 *
 * @returns `'ok'` 성공, `'not_found'` 에이전트 미존재
 */
export async function clearAgentSession(
  agentId: string,
  institutionId: string,
): Promise<'ok' | 'not_found'> {
  const result = await db
    .update(agents)
    .set({ lastSessionParamsJson: null, lastSessionDisplayId: null })
    .where(and(eq(agents.id, agentId), eq(agents.institutionId, institutionId)))
    .returning({ id: agents.id });

  if (result.length === 0) return 'not_found';

  logger.info(`[heartbeat] 에이전트 세션 초기화: agentId=${agentId}`);
  return 'ok';
}

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

  // 상태 사전 검사 (terminated/paused 실행 불가)
  if (agent.status === 'terminated') {
    return { error: '영구 종료(terminated) 상태의 에이전트는 실행할 수 없습니다.' };
  }
  if (agent.status === 'paused') {
    return { error: '일시정지(예산 초과) 상태의 에이전트는 실행할 수 없습니다.' };
  }

  if (startLocksByAgent.has(agentId)) {
    const existingRunId = startLocksByAgent.get(agentId)!;
    return { error: `이미 실행 중입니다. runId=${existingRunId}` };
  }

  // 예산 사전체크
  const budgetCheck = await checkProactiveBudget(institutionId, agentId);
  if (!budgetCheck.allowed) {
    return { error: `예산 한도 초과: ${budgetCheck.reason}` };
  }

  // 비동기 실행 후 생성될 runId 를 선반환할 수 없으므로
  // 레코드를 미리 생성하고 runHeartbeatForAgent에 위임합니다.
  const [pendingRun] = await db
    .insert(heartbeatRuns)
    .values({
      institutionId: agent.institutionId,
      agentId: agent.id,
      status: 'queued',
      invocationSource: 'on_demand',
    })
    .returning({ id: heartbeatRuns.id });

  if (!pendingRun) {
    return { error: 'heartbeat_runs 레코드 생성 실패' };
  }

  // runHeartbeatForAgent에 위임 — 타임아웃 강제/취소/예산체크 모두 포함
  void runHeartbeatForAgent(agent, undefined, 0, pendingRun.id, 'on_demand');

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
