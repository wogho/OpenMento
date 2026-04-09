/**
 * rag-queue-events.ts — BullMQ QueueEvents 기반 진행률 → socket.io 브릿지
 *                       (Phase 5-1 개선 ③)
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────────
 *
 *   rag-worker가 job.updateProgress()로 emit한 진행률 이벤트를 API 서버에서 수신하고,
 *   socket.io 'admin:<institutionId>' 룸으로 실시간 송출합니다.
 *
 *   프론트엔드 Admin 대시보드는 「rag:progress」 이벤트를 구독하여
 *   교재 임베딩 진행률 표시줄(0~100%)을 렌더링합니다.
 *
 * ── 이벤트 흐름 ────────────────────────────────────────────────────────────
 *
 *   [rag-worker] job.updateProgress({ current, total, institutionId, deliveryId })
 *         ↓  (Redis Pub/Sub)
 *   [API 서버 - QueueEvents]  progress 이벤트 수신
 *         ↓  (socket.io)
 *   [Admin 브라우저]  rag:progress 이벤트 → 진행률 바 업데이트
 *
 * ── 소켓 룸 ──────────────────────────────────────────────────────────────────
 *
 *   「admin:<institutionId>」 룸: 해당 기관의 admin 역할 소켓이 자동 입장합니다.
 *   (chat.handler.ts: role === 'admin' 인 경우 socket.join(`admin:${institutionId}`) 추가됨)
 */

import { QueueEvents } from 'bullmq';
import { logger } from '../utils/logger.js';
import { io } from '../socket/chat.handler.js';

export const RAG_INGEST_QUEUE_NAME = 'rag-ingest';

/** rag-worker → QueueEvents 로 수신되는 progress 페이로드 */
interface RagProgressPayload {
  current: number;
  total: number;
  institutionId: string;
  deliveryId: string;
  phase: 'db_save';
}

let _ragQueueEvents: QueueEvents | null = null;

/** Redis URL을 ioredis 옵션으로 파싱 */
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

/**
 * BullMQ QueueEvents 구독을 시작합니다.
 *
 * REDIS_URL 이 없으면 아무것도 하지 않습니다 (로컬 개발 환경 호환).
 */
export function startRagQueueEvents(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  try {
    _ragQueueEvents = new QueueEvents(RAG_INGEST_QUEUE_NAME, {
      connection: parseRedisUrl(redisUrl),
    });

    // ── Job 진행률 이벤트 ─────────────────────────────────────────────────────
    _ragQueueEvents.on('progress', ({ jobId, data }) => {
      const payload = data as RagProgressPayload;
      const { current, total, institutionId, deliveryId } = payload ?? {};

      if (!institutionId) return;

      const pct = total > 0 ? Math.round((current / total) * 100) : 0;

      // Admin 소켓 룸에 진행률 push
      io?.to(`admin:${institutionId}`).emit('rag:progress', {
        jobId,
        deliveryId,
        current,
        total,
        percent: pct,
      });

      logger.debug(
        { jobId, deliveryId, current, total, pct },
        '[rag-queue-events] 진행률 emit',
      );
    });

    // ── Job 완료 이벤트 ────────────────────────────────────────────────────────
    _ragQueueEvents.on('completed', ({ jobId }) => {
      // 완료 시 진행률 100% 송출 — jobId로 institutionId 조회 불가하므로
      // completed 에는 returnvalue가 없으므로 별도 처리 생략 (프론트엔드는 문서 목록 재조회)
      logger.info({ jobId }, '[rag-queue-events] Job 완료');
    });

    // ── Job 실패 이벤트 ────────────────────────────────────────────────────────
    _ragQueueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.warn({ jobId, failedReason }, '[rag-queue-events] Job 실패 (DLQ 보관됨)');
    });

    logger.info('[rag-queue-events] QueueEvents 구독 시작');
  } catch (err) {
    logger.error({ err }, '[rag-queue-events] QueueEvents 초기화 실패');
  }
}

/** 프로세스 종료 시 QueueEvents 연결 해제 */
export async function closeRagQueueEvents(): Promise<void> {
  if (_ragQueueEvents) {
    await _ragQueueEvents.close();
    _ragQueueEvents = null;
  }
}
