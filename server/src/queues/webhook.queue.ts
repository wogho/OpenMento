/**
 * webhook.queue.ts — GitHub Webhook BullMQ 큐 정의
 *
 * plan.md Phase 2-5 개선 ①: 비동기 큐 전환
 *
 * ── 설계 ────────────────────────────────────────────────────────────────────
 *
 *   - REDIS_URL 환경변수가 있으면 BullMQ Queue를 생성하여 반환
 *   - REDIS_URL 이 없으면 null 반환 → webhook.ts에서 in-process fallback 사용
 *
 * ── 큐 Job 설정 ──────────────────────────────────────────────────────────────
 *
 *   - attempts: 4 (최초 1회 + 재시도 3회) ③ Exponential Backoff
 *   - backoff: exponential, delay 2000ms (2s→4s→8s)
 *   - removeOnComplete: 100개 보관 후 자동 삭제
 *   - removeOnFail: 200개 보관 (디버깅용)
 */

import { Queue } from 'bullmq';
import { logger } from '../utils/logger.js';
import type { WebhookJobData } from './webhook.job.js';

export const WEBHOOK_QUEUE_NAME = 'github-webhook';

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

let _webhookQueue: Queue<WebhookJobData> | null = null;

/**
 * BullMQ Queue 인스턴스를 반환합니다.
 * REDIS_URL 환경변수가 없으면 null을 반환하여 in-process fallback을 사용합니다.
 */
export function getWebhookQueue(): Queue<WebhookJobData> | null {
  if (_webhookQueue) return _webhookQueue;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('[webhook-queue] REDIS_URL 미설정 — in-process fallback 사용');
    return null;
  }

  try {
    _webhookQueue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
      connection: parseRedisUrl(redisUrl),
      defaultJobOptions: {
        attempts: 4,                        // ③ 총 4회 시도 (최초 1 + 재시도 3)
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
    logger.info({ redisUrl: redisUrl.replace(/:\/\/.*@/, '://***@') }, '[webhook-queue] BullMQ Queue 초기화 완료');
    return _webhookQueue;
  } catch (err) {
    logger.error({ err }, '[webhook-queue] BullMQ Queue 초기화 실패 — in-process fallback 사용');
    return null;
  }
}

/** 프로세스 종료 시 큐 연결 해제 */
export async function closeWebhookQueue(): Promise<void> {
  if (_webhookQueue) {
    await _webhookQueue.close();
    _webhookQueue = null;
  }
}
