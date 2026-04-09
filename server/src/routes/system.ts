/**
 * system.ts — 시스템 상태 모니터링 라우터 (Phase 5-4)
 *
 * ── 엔드포인트 ────────────────────────────────────────────────────────────────
 *
 *   GET  /admin/system/status   — API·DB·Redis·Scheduler 상태 집계 반환
 *   GET  /admin/system/agents   — 에이전트별 최근 실행 이력 (heartbeat_runs JOIN agents)
 *   POST /admin/system/restart  — graceful restart (Docker restart: unless-stopped 정책 활용)
 *
 * ── 권한 ──────────────────────────────────────────────────────────────────────
 *
 *   모든 엔드포인트: admin 역할 전용 (index.ts에서 adminLimiter + adminRouter로 등록)
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  db,
  agents,
  heartbeatRuns,
  eq,
  desc,
  sql,
} from '@educlip/db';
import { getSystemStatus } from '../services/system-status.js';
import { logger } from '../utils/logger.js';

const router: ReturnType<typeof Router> = Router();

// ── GET /admin/system/status — 서비스 전체 상태 조회 ─────────────────────────
router.get('/status', async (_req, res) => {
  try {
    const status = await getSystemStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, '[system] 상태 조회 실패');
    res.status(500).json({ error: '상태 조회 중 오류가 발생했습니다.' });
  }
});

// ── GET /admin/system/agents — 에이전트별 최근 실행 이력 ─────────────────────
router.get('/agents', async (req, res) => {
  const { institutionId } = req.user!;

  try {
    // 에이전트별 가장 최근 heartbeat_run 1개 (DISTINCT ON 패턴)
    const rows = await db
      .select({
        agentId: agents.id,
        agentName: agents.name,
        role: agents.role,
        isActive: agents.isActive,
        runId: heartbeatRuns.id,
        runStatus: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        errorMessage: heartbeatRuns.errorMessage,
        stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
      })
      .from(agents)
      .leftJoin(
        heartbeatRuns,
        sql`${heartbeatRuns.id} = (
          SELECT id FROM heartbeat_runs
          WHERE agent_id = ${agents.id}
          ORDER BY created_at DESC
          LIMIT 1
        )`,
      )
      .where(eq(agents.institutionId, institutionId))
      .orderBy(desc(agents.createdAt));

    res.json(rows);
  } catch (err) {
    logger.error({ err }, '[system] 에이전트 상태 조회 실패');
    res.status(500).json({ error: '에이전트 상태 조회 중 오류가 발생했습니다.' });
  }
});

// ── GET /admin/system/runs — heartbeat_runs 최근 이력 (로그 보기용) ─────────
const runsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  agentId: z.string().uuid().optional(),
});

router.get('/runs', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = runsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: '잘못된 쿼리 파라미터입니다.', issues: parsed.error.issues });
    return;
  }
  const { limit, agentId } = parsed.data;

  try {
    const rows = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        agentName: agents.name,
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        finishedAt: heartbeatRuns.finishedAt,
        errorMessage: heartbeatRuns.errorMessage,
        stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
        resultJson: heartbeatRuns.resultJson,
        createdAt: heartbeatRuns.createdAt,
      })
      .from(heartbeatRuns)
      .leftJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .where(
        agentId
          ? sql`${heartbeatRuns.institutionId} = ${institutionId} AND ${heartbeatRuns.agentId} = ${agentId}`
          : eq(heartbeatRuns.institutionId, institutionId),
      )
      .orderBy(desc(heartbeatRuns.createdAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, '[system] 실행 이력 조회 실패');
    res.status(500).json({ error: '실행 이력 조회 중 오류가 발생했습니다.' });
  }
});

// ── POST /admin/system/restart — 서비스 Graceful Restart ─────────────────────
// Docker Compose restart: unless-stopped 정책 + SIGTERM → 프로세스 종료 → Docker 재기동
// 주의: 응답을 전송한 후 1초 지연 후 종료합니다.
router.post('/restart', (req, res) => {
  const { sub: userId } = req.user!;
  logger.warn({ userId }, '[system] 서비스 재시작 요청 수신 — 1초 후 graceful shutdown 시작');

  res.json({
    message: '서비스 재시작이 예약되었습니다. 잠시 후 자동으로 재기동됩니다.',
    scheduledAt: new Date().toISOString(),
  });

  // 응답 전송 완료 후 종료 (Docker restart policy가 재기동 처리)
  res.on('finish', () => {
    setTimeout(() => {
      logger.warn('[system] SIGTERM self-send — Docker restart policy에 의해 재기동됩니다.');
      process.kill(process.pid, 'SIGTERM');
    }, 1000);
  });
});

export default router;
