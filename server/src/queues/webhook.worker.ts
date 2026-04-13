/**
 * webhook.worker.ts — GitHub Webhook BullMQ Worker
 *
 * plan.md Phase 2-5 개선 ①②③④:
 *   ① BullMQ 비동기 큐 처리 (LLM 호출을 응답 후 백그라운드에서 실행)
 *   ② Zod 페이로드 런타임 검증
 *   ③ BullMQ 내장 Exponential Backoff (attempts: 4, delay: 2s)
 *   ④ Budget Guard 연동 (Phase 2-7 준비)
 *
 * ── 실행 방식 ────────────────────────────────────────────────────────────────
 *
 *   REDIS_URL 환경변수가 설정된 경우 → Worker를 시작합니다.
 *   REDIS_URL 이 없는 경우 → null 반환, webhook.ts의 in-process fallback 사용.
 *
 * ── 재시도 정책 ③ ────────────────────────────────────────────────────────────
 *
 *   BullMQ defaultJobOptions:
 *     attempts: 4 (최초 1 + 재시도 3)
 *     backoff: exponential, delay 2000ms
 *     시도 간격: 2s → 4s → 8s
 */

import { Worker } from 'bullmq';
import {
  db,
  routines,
  routineTriggers,
  agents,
  students,
  eq,
  and,
  isNull,
} from '@openmento/db';
import {
  generateCodeReview,
  summarizePushPayload,
  summarizePrPayload,
  GitHubPushPayloadSchema,
  GitHubPrPayloadSchema,
} from '../services/github-code-review.js';
import { triggerAgentManually } from '../services/heartbeat.js';
import { checkProactiveBudget } from '../services/budget-guard.js';
import { io } from '../socket/chat.handler.js';
import { logger } from '../utils/logger.js';
import { WEBHOOK_QUEUE_NAME } from './webhook.queue.js';
import type { WebhookJobData } from './webhook.job.js';

/** Redis connection 파싱 (webpack queue와 동일) */
function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

let _worker: Worker<WebhookJobData> | null = null;

/**
 * BullMQ Worker를 시작합니다.
 * REDIS_URL 환경변수가 없으면 null을 반환합니다.
 */
export function startWebhookWorker(): Worker<WebhookJobData> | null {
  if (_worker) return _worker;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  _worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    async (job) => {
      const { eventType, repoFullName, payloadJson, deliveryId } = job.data;
      const startedAt = Date.now();

      logger.info(
        { jobId: job.id, deliveryId, event: eventType, repo: repoFullName, attempt: job.attemptsMade + 1 },
        '[webhook-worker] Job 처리 시작',
      );

      // ── ② Zod 페이로드 검증 ────────────────────────────────────────────────
      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(payloadJson);
      } catch {
        throw new Error(`[webhook-worker] payloadJson 파싱 실패 (deliveryId=${deliveryId})`);
      }

      const parseResult =
        eventType === 'push'
          ? GitHubPushPayloadSchema.safeParse(rawPayload)
          : GitHubPrPayloadSchema.safeParse(rawPayload);

      if (!parseResult.success) {
        // 스키마 검증 실패 → 재시도 불필요(데이터 자체가 잘못됨) → 에러를 던지되 BullMQ 가 재시도 X
        // BullMQ에서 UnrecoverableError를 사용하면 재시도 없이 즉시 실패 처리함
        const { UnrecoverableError } = await import('bullmq');
        throw new UnrecoverableError(
          `[webhook-worker] Zod 스키마 검증 실패: ${parseResult.error.message}`,
        );
      }

      const payload = parseResult.data;

      // ── routine_triggers(kind="webhook") 매칭 ──────────────────────────────
      const matchedTriggers = await db
        .select({
          triggerId: routineTriggers.id,
          routineId: routineTriggers.routineId,
          routineAgentId: routines.agentId,
          routineInstitutionId: routines.institutionId,
          routineCourseId: routines.courseId,
          routineIsActive: routines.isActive,
        })
        .from(routineTriggers)
        .innerJoin(routines, eq(routineTriggers.routineId, routines.id))
        .where(
          and(
            eq(routineTriggers.kind, 'webhook'),
            eq(routineTriggers.webhookEvent, eventType),
            eq(routineTriggers.isActive, true),
            eq(routines.isActive, true),
          ),
        );

      if (matchedTriggers.length === 0) {
        logger.info({ event: eventType, repo: repoFullName }, '[webhook-worker] 매칭된 routine_trigger 없음');
        return;
      }

      for (const trigger of matchedTriggers) {
        const institutionId = trigger.routineInstitutionId;
        const agentId = trigger.routineAgentId;

        // ── ④ Budget Guard ────────────────────────────────────────────────────
        const budget = await checkProactiveBudget(institutionId, agentId);
        if (!budget.allowed) {
          logger.warn(
            { institutionId, agentId, reason: budget.reason },
            '[webhook-worker] 예산 소진 — 코드 리뷰 건너뜀',
          );
          continue;
        }

        // ── ai_instructor 에이전트 유효성 확인 ───────────────────────────────
        const [agentRow] = await db
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.id, agentId),
              eq(agents.institutionId, institutionId),
              eq(agents.isActive, true),
              isNull(agents.deletedAt),
            ),
          );

        if (!agentRow) {
          logger.warn({ agentId }, '[webhook-worker] 에이전트를 찾을 수 없음');
          continue;
        }

        // ── Heartbeat 수동 트리거 ─────────────────────────────────────────────
        const wakeupResult = await triggerAgentManually(agentId, institutionId);
        if ('error' in wakeupResult) {
          logger.warn({ agentId, error: wakeupResult.error }, '[webhook-worker] 에이전트 wakeup 실패');
        }

        // ── 수강생 매핑 ───────────────────────────────────────────────────────
        const [student] = await db
          .select({ id: students.id, courseId: students.courseId })
          .from(students)
          .where(
            and(
              eq(students.githubRepo, repoFullName),
              eq(students.institutionId, institutionId),
              isNull(students.deletedAt),
            ),
          );

        if (!student) {
          logger.info({ repo: repoFullName }, '[webhook-worker] 수강생 매핑 없음 — 건너뜀');
          continue;
        }

        // ── diff 요약 생성 ────────────────────────────────────────────────────
        const diffSummary =
          eventType === 'push'
            ? summarizePushPayload(payload as Parameters<typeof summarizePushPayload>[0])
            : summarizePrPayload(payload as Parameters<typeof summarizePrPayload>[0]);

        const reviewUrl =
          eventType === 'push'
            ? (payload as { compare: string }).compare
            : (payload as { pull_request: { html_url: string } }).pull_request.html_url;

        // ── AI 코드 리뷰 생성 ③ BullMQ 재시도가 LLM 실패 시 자동 처리 ─────────
        const reviewResult = await generateCodeReview({
          studentId: student.id,
          institutionId,
          courseId: trigger.routineCourseId ?? student.courseId ?? undefined,
          agentId,
          eventType,
          diffSummary,
          repoFullName,
          url: reviewUrl,
        });

        // ── WebSocket Push ────────────────────────────────────────────────────
        if (io) {
          io.to(`student:${student.id}`).emit('code_review_arrived', {
            sessionId: reviewResult.sessionId,
            messageId: reviewResult.messageId,
            repo: repoFullName,
            event: eventType,
            preview: reviewResult.review.slice(0, 120) + '...',
          });
          logger.info(
            { studentId: student.id, messageId: reviewResult.messageId },
            '[webhook-worker] WebSocket 코드 리뷰 알림 전송',
          );
        }
      }

      logger.info(
        { jobId: job.id, deliveryId, elapsed: Date.now() - startedAt },
        '[webhook-worker] Job 처리 완료',
      );
    },
    {
      connection: parseRedisUrl(redisUrl),
      concurrency: 3,   // 동시 처리 Job 수 제한
    },
  );

  _worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, deliveryId: job?.data.deliveryId, err, attempt: job?.attemptsMade },
      '[webhook-worker] Job 실패',
    );
  });

  _worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, '[webhook-worker] Job 완료');
  });

  logger.info('[webhook-worker] BullMQ Worker 시작');
  return _worker;
}

/** 프로세스 종료 시 Worker 정리 */
export async function closeWebhookWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
