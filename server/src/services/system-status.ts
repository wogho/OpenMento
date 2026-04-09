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

import { sql } from '@educlip/db';
import { db } from '@educlip/db';
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

/** PostgreSQL SELECT 1 헬스체크 */
async function checkDbHealth(): Promise<ServiceInfo> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { name: 'Database', status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err }, '[system-status] DB 헬스체크 실패');
    return { name: 'Database', status: 'down', latencyMs: null, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Redis ping 헬스체크 (REDIS_URL 없으면 unavailable) */
async function checkRedisHealth(): Promise<ServiceInfo> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return { name: 'Redis', status: 'unavailable', latencyMs: null, detail: 'REDIS_URL 미설정' };
  }

  const start = Date.now();
  try {
    // ioredis 동적 import — 런타임에 bullmq 의존성 활용
    const { default: Redis } = await import('ioredis');
    const url = new URL(redisUrl);
    const client = new Redis({
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password || undefined,
      username: url.username || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await client.connect();
    await client.ping();
    await client.quit();
    return { name: 'Redis', status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    logger.warn({ err }, '[system-status] Redis 헬스체크 실패');
    return { name: 'Redis', status: 'down', latencyMs: null, detail: err instanceof Error ? err.message : String(err) };
  }
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
