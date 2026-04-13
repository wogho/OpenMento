/**
 * system-status.ts — 서비스 상태 체크 유틸리티 (Phase 5-4)
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────────
 *
 *   GET /admin/system/status 엔드포인트에서 호출하여 각 서비스의 헬스를 집계합니다.
 *
 *   - API Server  : 이 함수가 응답하면 OK
 *   - Database    : SELECT 1 응답 시간 측정
 *   - Redis       : REDIS_URL 있으면 ping, 없으면 'unavailable'
 *   - AI Scheduler: Heartbeat 스케줄러 실행 여부
 *
 */

import { sql } from '@openmento/db';
import { db } from '@openmento/db';
import { getHeartbeatStatus } from './heartbeat.js';
import { logger } from '../utils/logger.js';

export type ServiceStatus = 'ok' | 'degraded' | 'down' | 'unavailable';

export interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  detail?: string;
}

export interface SystemStatusResult {
  services: ServiceInfo[];
  uptime: number;
  memoryMb: number;
  timestamp: string;
}

/**
 * withTimeout — Promise.race 기반 헬스체크 타임아웃 유틸 (Phase 5-4 개선)
 *
 * DB/Redis가 장시간 응답하지 않을 때(Hang) 이벤트 루프 고갈 방지를 위해
 * 지정된 ms 내에 응답이 없으면 즉각 fallback 값을 반환합니다.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error(`헬스체크 타임아웃 (${ms}ms 초과)`)), ms),
  );
  return Promise.race([promise, timeout]).catch((err: unknown) => {
    logger.warn({ err }, '[system-status] 헬스체크 타임아웃 — fallback 반환');
    return fallback;
  });
}

/** DB 헬스체크 타임아웃 기본값 (ms) */
const DB_HEALTH_TIMEOUT_MS = 3000;

/** Redis 헬스체크 타임아웃 기본값 (ms) */
const REDIS_HEALTH_TIMEOUT_MS = 2000;

/** PostgreSQL SELECT 1 헬스체크 (최대 3초 대기) */
async function checkDbHealth(): Promise<ServiceInfo> {
  const start = Date.now();

  const TIMEOUT_FALLBACK: ServiceInfo = {
    name: 'Database',
    status: 'down',
    latencyMs: null,
    detail: `응답 없음 (${DB_HEALTH_TIMEOUT_MS}ms 타임아웃)`,
  };

  return withTimeout(
    (async () => {
      try {
        await db.execute(sql`SELECT 1`);
        return { name: 'Database', status: 'ok' as ServiceStatus, latencyMs: Date.now() - start };
      } catch (err) {
        logger.warn({ err }, '[system-status] DB 헬스체크 실패');
        return {
          name: 'Database',
          status: 'down' as ServiceStatus,
          latencyMs: null,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    })(),
    DB_HEALTH_TIMEOUT_MS,
    TIMEOUT_FALLBACK,
  );
}

/** Redis ping 헬스체크 (REDIS_URL 없으면 unavailable, 최대 2초 대기) */
async function checkRedisHealth(): Promise<ServiceInfo> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return { name: 'Redis', status: 'unavailable', latencyMs: null, detail: 'REDIS_URL 미설정' };
  }

  const start = Date.now();

  const TIMEOUT_FALLBACK: ServiceInfo = {
    name: 'Redis',
    status: 'down',
    latencyMs: null,
    detail: `응답 없음 (${REDIS_HEALTH_TIMEOUT_MS}ms 타임아웃)`,
  };

  return withTimeout(
    (async () => {
      try {
        // ioredis 동적 import — 런타임에 bullmq 의존성 활용
        const { default: RedisClass } = await import('ioredis');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Redis = RedisClass as any;
        const url = new URL(redisUrl);
        const client = new Redis({
          host: url.hostname,
          port: parseInt(url.port || '6379', 10),
          password: url.password || undefined,
          username: url.username || undefined,
          tls: url.protocol === 'rediss:' ? {} : undefined,
          connectTimeout: 1500,      // withTimeout 외 내부 연결 타임아웃도 단축
          maxRetriesPerRequest: 0,   // 타임아웃 상황에서 재시도 없이 즉시 실패
          lazyConnect: true,
        });
        await client.connect();
        await client.ping();
        await client.quit();
        return { name: 'Redis', status: 'ok' as ServiceStatus, latencyMs: Date.now() - start };
      } catch (err) {
        logger.warn({ err }, '[system-status] Redis 헬스체크 실패');
        return {
          name: 'Redis',
          status: 'down' as ServiceStatus,
          latencyMs: null,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    })(),
    REDIS_HEALTH_TIMEOUT_MS,
    TIMEOUT_FALLBACK,
  );
}

/** Heartbeat 스케줄러 상태 조회 */
function checkSchedulerHealth(): ServiceInfo {
  const status = getHeartbeatStatus();
  return {
    name: 'AI Scheduler',
    status: status.isRunning ? 'ok' : 'stopped' as ServiceStatus,
    latencyMs: null,
    detail: `실행 중: ${status.currentConcurrentRuns}/${status.maxConcurrentRuns} | 잠금 에이전트: ${status.lockedAgents.length}`,
  };
}

/** 전체 서비스 상태 집계 */
export async function getSystemStatus(): Promise<SystemStatusResult> {
  const [dbHealth, redisHealth] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),
  ]);

  const schedulerHealth = checkSchedulerHealth();

  const apiHealth: ServiceInfo = {
    name: 'API Server',
    status: 'ok',
    latencyMs: null,
    detail: `uptime ${Math.floor(process.uptime())}s`,
  };

  const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  return {
    services: [apiHealth, dbHealth, redisHealth, schedulerHealth],
    uptime: Math.floor(process.uptime()),
    memoryMb: memMb,
    timestamp: new Date().toISOString(),
  };
}
