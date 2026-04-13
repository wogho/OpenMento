/**
 * bull-board.ts — BullMQ 큐 모니터링 Admin 대시보드 (Phase 5-1 개선 ①)
 *
 * 경로: /admin/queues/* (admin 역할 전용)
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────────
 *
 *   @bull-board/express + BullMQAdapter를 사용하여 rag-ingest / github-webhook
 *   큐의 Job 목록·상태·진행률을 웹 UI에서 실시간으로 확인합니다.
 *
 * ── DLQ(Dead Letter Queue) 개념 ───────────────────────────────────────────────
 *
 *   BullMQ에서 attempts를 모두 소진하고 실패한 Job은 "failed" 상태로 큐에 보관됩니다.
 *   removeOnFail: { count: 500 }  → 최대 500개의 실패 Job 보관 (rag-ingest.queue.ts)
 *   Bull Board의 Failed 탭에서 관리자가 개별 Job을 재처리(Retry) 또는 삭제할 수 있습니다.
 *
 * ── 접근 보안 ─────────────────────────────────────────────────────────────────
 *
 *   authenticate + requireRole('admin') 미들웨어로 보호됩니다.
 *   REDIS_URL 환경변수가 없으면 대시보드가 비활성화되고 빈 라우터를 반환합니다.
 */

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { getRagIngestQueue } from '../queues/rag-ingest.queue.js';
import { getWebhookQueue } from '../queues/webhook.queue.js';
import { logger } from '../utils/logger.js';

export const BULL_BOARD_BASE_PATH = '/admin/queues';

/**
 * Bull Board 라우터를 초기화하고 반환합니다.
 *
 * REDIS_URL이 없는 경우 빈 JSON 응답 라우터를 반환합니다 (로컬 개발 환경 호환).
 */
export function createBullBoardRouter(): Router {
  const router = Router();

  const ragQueue = getRagIngestQueue();
  const webhookQueue = getWebhookQueue();

  if (!ragQueue && !webhookQueue) {
    logger.warn('[bull-board] REDIS_URL 미설정 — Bull Board 비활성화');
    router.get('*', authenticate, requireRole('admin'), (_req, res) => {
      res.status(503).json({ error: 'Bull Board는 Redis 연결이 필요합니다.' });
    });
    return router;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);

  const queueAdapters: BullMQAdapter[] = [];
  if (ragQueue) {
    queueAdapters.push(
      new BullMQAdapter(ragQueue, {
        readOnlyMode: false,
        allowRetries: true,
        // DLQ 역할: Failed 탭에서 Retry 버튼 활성화
        description: 'RAG 임베딩 작업 큐 — 실패 Job: Failed 탭에서 Retry 가능',
      }),
    );
  }
  if (webhookQueue) {
    queueAdapters.push(
      new BullMQAdapter(webhookQueue, {
        readOnlyMode: false,
        allowRetries: true,
        description: 'GitHub Webhook 처리 큐 — 실패 Job: Failed 탭에서 Retry 가능',
      }),
    );
  }

  createBullBoard({ queues: queueAdapters, serverAdapter });

  // Admin 전용 미들웨어 → Bull Board UI 서빙
  router.use(authenticate, requireRole('admin'), serverAdapter.getRouter());

  logger.info(
    { path: BULL_BOARD_BASE_PATH, queues: queueAdapters.length },
    '[bull-board] 큐 모니터링 대시보드 초기화 완료',
  );

  return router;
}
