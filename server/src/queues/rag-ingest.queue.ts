/**
 * rag-ingest.queue.ts — RAG 임베딩 BullMQ 큐 정의
 *
 * plan.md Phase 5-A: API 서버 → rag-worker 비동기 분리
 *
 * ── 설계 ─────────────────────────────────────────────────────────────────────
 *
 *   - REDIS_URL 환경변수가 있으면 BullMQ Queue를 생성하여 반환
 *   - REDIS_URL 이 없으면 null 반환 → admin.ts에서 직접 ingestDocument() fallback 사용
 *   - webhook.queue.ts와 동일한 패턴 (parseRedisUrl, getter 함수, close 함수)
 *
 * ── 큐 Job 설정 ──────────────────────────────────────────────────────────────
 *
 *   - attempts: 3 (최초 1회 + 재시도 2회) — 임베딩 실패는 주로 Rate Limit 이므로 재시도 유용
 *   - backoff: exponential, delay 5000ms (5s→10s→20s) — OpenAI Rate Limit 대응
 *   - removeOnComplete: 200개 보관 (업로드 이력 확인용)
 *   - removeOnFail: 500개 보관 (오류 진단용)
 */

import { Queue } from 'bullmq';
import { logger } from '../utils/logger.js';
import type { RagIngestJobData } from './rag-ingest.job.js';

export const RAG_INGEST_QUEUE_NAME = 'rag-ingest';

/** Redis 연결 설정 (REDIS_URL → ioredis connection option) */
function parseRedisUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null as null, // BullMQ 필수 설정
  };
}

let _ragIngestQueue: Queue<RagIngestJobData> | null = null;

/**
 * BullMQ Queue 인스턴스를 반환합니다.
 * REDIS_URL 환경변수가 없으면 null을 반환하여 직접 ingestDocument() 호출로 fallback 합니다.
 */
export function getRagIngestQueue(): Queue<RagIngestJobData> | null {
  if (_ragIngestQueue) return _ragIngestQueue;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('[rag-ingest-queue] REDIS_URL 미설정 — 동기 ingestDocument() fallback 사용');
    return null;
  }

  try {
    _ragIngestQueue = new Queue<RagIngestJobData>(RAG_INGEST_QUEUE_NAME, {
      connection: parseRedisUrl(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 }, // OpenAI Rate Limit 대응: 5s→10s→20s
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
    logger.info(
      { redisUrl: redisUrl.replace(/:\/\/.*@/, '://***@') },
      '[rag-ingest-queue] BullMQ Queue 초기화 완료',
    );
    return _ragIngestQueue;
  } catch (err) {
    logger.error({ err }, '[rag-ingest-queue] BullMQ Queue 초기화 실패 — fallback 사용');
    return null;
  }
}

/** 프로세스 종료 시 큐 연결 해제 */
export async function closeRagIngestQueue(): Promise<void> {
  if (_ragIngestQueue) {
    await _ragIngestQueue.close();
    _ragIngestQueue = null;
  }
}
