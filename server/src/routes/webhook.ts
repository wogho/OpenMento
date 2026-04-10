/**
 * webhook.ts — GitHub Webhook 수신 라우터
 *
 * plan.md Phase 2-5: GitHub Webhook 기반 Proactive Interaction
 * plan.md Phase 2-5 개선 ①②③④ 적용
 *
 * ── 엔드포인트 ─────────────────────────────────────────────────────────────
 *
 *   POST /webhook/github
 *     Headers:
 *       X-Hub-Signature-256: sha256=<HMAC-SHA256>
 *       X-GitHub-Event: push | pull_request
 *       X-GitHub-Delivery: <UUID>
 *
 * ── 처리 플로우 ───────────────────────────────────────────────────────────
 *
 *   1. HMAC-SHA256 서명 검증 (GITHUB_WEBHOOK_SECRET env)
 *   2. ② Zod 런타임 페이로드 검증 (GitHubPushPayloadSchema / GitHubPrPayloadSchema)
 *   3. ① REDIS_URL 있음 → BullMQ Queue에 Job 추가 후 즉시 202 응답
 *      ① REDIS_URL 없음 → in-process 비동기 fallback (기존 방식)
 *   4. Worker(③ Exponential Backoff)가 백그라운드에서 코드 리뷰 생성
 *   5. ④ Budget Guard 확인 후 generateCodeReview() 실행
 *   6. Socket.io 해당 수강생 Room Push
 *
 * ── 보안 ────────────────────────────────────────────────────────────────────
 *
 *   - timingSafeEqual 로 타이밍 어택 방지 (OWASP: Insecure Communication)
 *   - raw Buffer 비교 — 문자열 비교 대신 사용
 *   - 서명 불일치 시 401 반환 (오류 메시지에 실제 서명값 노출 금지)
 *   - 페이로드 크기 제한: 5MB (Body Parser 미적용, raw Buffer 사용)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type Router as RouterType } from 'express';
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
import { triggerAgentManually } from '../services/heartbeat.js';
import {
  generateCodeReview,
  summarizePushPayload,
  summarizePrPayload,
  GitHubPushPayloadSchema,
  GitHubPrPayloadSchema,
} from '../services/github-code-review.js';
import type { GitHubPushPayload, GitHubPrPayload } from '../services/github-code-review.js';
import { checkProactiveBudget } from '../services/budget-guard.js';
import { io } from '../socket/chat.handler.js';
import { logger } from '../utils/logger.js';
import { getWebhookQueue } from '../queues/webhook.queue.js';

const router: RouterType = Router();

// ── HMAC-SHA256 서명 검증 ────────────────────────────────────────────────────

function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedSig = Buffer.from(
    createHmac('sha256', secret).update(rawBody).digest('hex'),
  );
  const receivedSig = Buffer.from(signatureHeader.slice(7));
  if (expectedSig.length !== receivedSig.length) return false;
  return timingSafeEqual(expectedSig, receivedSig);
}

// ── 이벤트 타입 정규화 ────────────────────────────────────────────────────────

type SupportedGitHubEvent = 'push' | 'pull_request';

function isSupportedEvent(event: string): event is SupportedGitHubEvent {
  return event === 'push' || event === 'pull_request';
}

// ── DB 기반 in-process 처리 (REDIS_URL 미설정 시 fallback) ────────────────────

async function processWebhookInProcess(
  eventType: SupportedGitHubEvent,
  payload: GitHubPushPayload | GitHubPrPayload,
  repoFullName: string,
  deliveryId: string,
): Promise<void> {
  const matchedTriggers = await db
    .select({
      triggerId: routineTriggers.id,
      routineAgentId: routines.agentId,
      routineInstitutionId: routines.institutionId,
      routineCourseId: routines.courseId,
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
    logger.info({ event: eventType, repo: repoFullName }, '[webhook] 매칭 트리거 없음');
    return;
  }

  for (const trigger of matchedTriggers) {
    try {
      const { routineAgentId: agentId, routineInstitutionId: institutionId } = trigger;

      // ④ Budget Guard
      const budget = await checkProactiveBudget(institutionId, agentId);
      if (!budget.allowed) {
        logger.warn({ institutionId, reason: budget.reason }, '[webhook] 예산 소진 — 건너뜀');
        continue;
      }

      const [agentRow] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.institutionId, institutionId), eq(agents.isActive, true), isNull(agents.deletedAt)));

      if (!agentRow) { logger.warn({ agentId }, '[webhook] 에이전트 없음'); continue; }

      const wakeupResult = await triggerAgentManually(agentId, institutionId);
      if ('error' in wakeupResult) logger.warn({ agentId, error: wakeupResult.error }, '[webhook] wakeup 실패');

      const [student] = await db
        .select({ id: students.id, courseId: students.courseId })
        .from(students)
        .where(and(eq(students.githubRepo, repoFullName), eq(students.institutionId, institutionId), isNull(students.deletedAt)));

      if (!student) { logger.info({ repo: repoFullName }, '[webhook] 수강생 매핑 없음'); continue; }

      const diffSummary = eventType === 'push'
        ? summarizePushPayload(payload as GitHubPushPayload)
        : summarizePrPayload(payload as GitHubPrPayload);
      const reviewUrl = eventType === 'push'
        ? (payload as GitHubPushPayload).compare
        : (payload as GitHubPrPayload).pull_request.html_url;

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

      if (io) {
        io.to(`student:${student.id}`).emit('code_review_arrived', {
          sessionId: reviewResult.sessionId,
          messageId: reviewResult.messageId,
          repo: repoFullName,
          event: eventType,
          preview: reviewResult.review.slice(0, 120) + '...',
        });
      }
    } catch (err) {
      logger.error({ err, triggerId: trigger.triggerId, deliveryId }, '[webhook] 트리거 처리 오류');
    }
  }
}

// ── POST /webhook/github ─────────────────────────────────────────────────────

router.post('/github', async (req: Request, res: Response) => {
  // ── 1. 서명 검증 ──────────────────────────────────────────────────────────
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[webhook] GITHUB_WEBHOOK_SECRET 환경변수 미설정');
    res.status(500).json({ error: '서버 설정 오류' });
    return;
  }

  const rawBody = req.body as Buffer;
  const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;
  const deliveryId = (req.headers['x-github-delivery'] as string | undefined) ?? 'unknown';

  if (!verifyGitHubSignature(rawBody, signatureHeader, secret)) {
    logger.warn({ deliveryId }, '[webhook] 서명 검증 실패');
    res.status(401).json({ error: '유효하지 않은 Webhook 서명입니다.' });
    return;
  }

  // ── 2. 이벤트 타입 확인 ────────────────────────────────────────────────────
  const eventHeader = req.headers['x-github-event'] as string | undefined;
  if (!eventHeader || !isSupportedEvent(eventHeader)) {
    res.json({ received: true, processed: false, reason: '미지원 이벤트 타입' });
    return;
  }

  // ── ② Zod 런타임 페이로드 검증 ────────────────────────────────────────────
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: '페이로드 JSON 파싱 실패' });
    return;
  }

  const parseResult =
    eventHeader === 'push'
      ? GitHubPushPayloadSchema.safeParse(rawJson)
      : GitHubPrPayloadSchema.safeParse(rawJson);

  if (!parseResult.success) {
    logger.warn(
      { deliveryId, issues: parseResult.error.issues.slice(0, 3) },
      '[webhook] Zod 페이로드 검증 실패',
    );
    res.status(400).json({ error: '페이로드 스키마 검증 실패' });
    return;
  }

  const payload = parseResult.data as GitHubPushPayload | GitHubPrPayload;

  // pull_request closed 무시
  if (eventHeader === 'pull_request' && (payload as GitHubPrPayload).action === 'closed') {
    res.json({ received: true, processed: false, reason: 'PR closed 이벤트 무시' });
    return;
  }

  const repoFullName = payload.repository.full_name;

  logger.info({ event: eventHeader, repo: repoFullName, deliveryId }, '[webhook] Webhook 수신');

  // ── 즉시 202 응답 ① ────────────────────────────────────────────────────────
  res.status(202).json({ received: true, processed: true });

  // ── ① BullMQ 큐 위임 or in-process fallback ──────────────────────────────
  const queue = getWebhookQueue();
  if (queue) {
    await queue.add(
      `${eventHeader}:${deliveryId}`,
      {
        eventType: eventHeader,
        repoFullName,
        payloadJson: rawBody.toString('utf-8'),
        deliveryId,
      },
      { jobId: deliveryId }, // idempotency: 같은 delivery 중복 방지
    );
    logger.info({ deliveryId, repo: repoFullName }, '[webhook] Job 큐에 추가됨');
  } else {
    void processWebhookInProcess(eventHeader, payload, repoFullName, deliveryId);
  }
});

export default router;
