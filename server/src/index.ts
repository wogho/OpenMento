import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { createServer } from 'node:http';
import authRouter from './routes/auth.js';
import studentRouter from './routes/student.js';
import instructorRouter from './routes/instructor.js';
import adminRouter from './routes/admin.js';
import webhookRouter from './routes/webhook.js';
import portfolioRouter from './routes/portfolio.js';
import superAdminRouter from './routes/super-admin.js';
import { createBullBoardRouter, BULL_BOARD_BASE_PATH } from './routes/bull-board.js';
import { createSocketServer } from './socket/chat.handler.js';
import { startHeartbeatScheduler, stopHeartbeatScheduler } from './services/heartbeat.js';
import { startWebhookWorker, closeWebhookWorker } from './queues/webhook.worker.js';
import { initEwsThresholdsDb, loadEwsThresholdsFromDb } from './services/ews-thresholds.js';
import { initInstitutionSettingsDb, loadAllInstitutionSettings, getInstitutionSetting } from './services/institution-settings-service.js';
import { closeWebhookQueue } from './queues/webhook.queue.js';
import { closeRagIngestQueue } from './queues/rag-ingest.queue.js';
import { startRagQueueEvents, closeRagQueueEvents } from './queues/rag-queue-events.js';
import { rlsErrorHandler } from './utils/tenant-assert.js';
import { logger } from './utils/logger.js';
import { authLimiter, adminLimiter, chatLimiter, webhookLimiter } from './middleware/rateLimiter.js';

const app = express();
const httpServer = createServer(app);

app.use(express.json());

// ── GitHub Webhook: raw Buffer 파싱 (HMAC 서명 검증에 원본 바이트 필요) ──────
// express.json() 적용 전에 등록해야 충돌 없음
app.use(
  '/webhook',
  express.raw({ type: 'application/json', limit: '5mb' }),
  webhookLimiter,
  webhookRouter,
);

// ── 공개 엔드포인트 ───────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'api',
    version: process.env.npm_package_version ?? '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// ── 인증 라우터 (공개) ────────────────────────────────────
app.use('/auth', authLimiter, authRouter);

// ── RBAC 보호 라우터 ──────────────────────────────────────
// plan.md 부록 B: /student/* /instructor/* /admin/* 라우트 분리
app.use('/student', chatLimiter, studentRouter);
app.use('/instructor', adminLimiter, instructorRouter);
app.use('/admin', adminLimiter, adminRouter);
app.use('/portfolio', chatLimiter, portfolioRouter);
// Phase 5-2: Super Admin — 전체 교육기관 통합 관리 (super_admin 역할 전용)
app.use('/super-admin', adminLimiter, superAdminRouter);

// ── BullMQ 큐 모니터링 대시보드 (Phase 5-1 개선 ①: DLQ + Admin UI) ──────────
// admin 역할 전용, REDIS_URL 있을 때만 활성화됩니다.
app.use(BULL_BOARD_BASE_PATH, adminLimiter, createBullBoardRouter());

// ── 미등록 라우트 처리 ────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: '존재하지 않는 엔드포인트입니다.' });
});

// ── RLS NotFound 에러 핸들러 (Phase 5-2 ③) ───────────────
// RlsNotFoundError 를 클라이언트에게 안전한 404 로 변환합니다.
// 서버 사이드 로그에는 RLS 컨텍스트 정보가 기록됩니다.
app.use(rlsErrorHandler);

// ── 전역 에러 핸들러 ─────────────────────────────────────
// multer 파일 크기 초과, 파일 형식 오류, 기타 uncaught 에러 처리
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '파일 크기가 50MB를 초과합니다.' });
      return;
    }
    res.status(400).json({ error: `파일 업로드 오류: ${err.message}` });
    return;
  }

  // 파일 형식 검증 오류 (multer fileFilter에서 던진 Error)
  if (err.message.includes('파일만 업로드')) {
    res.status(415).json({ error: err.message });
    return;
  }

  logger.error({ err }, '[server] 처리되지 않은 오류');
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

const PORT = Number(process.env.PORT) || 3000;

// Socket.io 서버 초기화 (chat.handler.ts)
createSocketServer(httpServer);

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, '[api] EduClip server listening');
  // ── EWS 임계치 DB 연결 + 프리워밍 (Phase 2 개선: 영속성 확보) ─
  // DB 인스턴스를 주입하고 저장된 모든 기관 임계치를 캐시에 적재합니다.
  // DB 접근 실패 시 기본값(60/75/90)으로 폴백하므로 서버 기동이 중단되지 않습니다.
  void (async () => {
    const { db } = await import('@educlip/db');
    initEwsThresholdsDb(db);
    await loadEwsThresholdsFromDb();
    logger.info('[ews-thresholds] DB 프리워밍 완료');
    // ── institution_settings 프리워밍 + 서버 재시작 시 secrets 복원 ─
    initInstitutionSettingsDb(db);
    await loadAllInstitutionSettings();
    logger.info('[institution-settings] DB 프리워밍 완료');
    // DB에 저장된 API 키를 process.env에 복원 (기본 기관 기준)
    const defaultSecrets = await getInstitutionSetting<Record<string, string>>('default', 'secrets', {});
    if (defaultSecrets['openaiApiKey']) process.env.OPENAI_API_KEY = defaultSecrets['openaiApiKey'];
    if (defaultSecrets['anthropicApiKey']) process.env.ANTHROPIC_API_KEY = defaultSecrets['anthropicApiKey'];
    if (defaultSecrets['slackWebhookUrl']) process.env.SLACK_WEBHOOK_URL = defaultSecrets['slackWebhookUrl'];
  })();
  // ── Heartbeat 스케줄러 기동 (Phase 2-1) ─────────────────────
  startHeartbeatScheduler();
  // ── BullMQ Webhook Worker 기동 (Phase 2-5 개선 ①) ───────────
  // REDIS_URL 환경변수가 있을 때만 Worker가 시작되고, 없으면 null 반환
  startWebhookWorker();
  // ── BullMQ QueueEvents 구독 시작 (Phase 5-1 개선 ③) ────────
  // rag-worker의 job.updateProgress() → socket.io admin 룸으로 진행률 브릿지
  startRagQueueEvents();
});

// 정상 종료 Handler
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down`);
  stopHeartbeatScheduler();
  await closeWebhookWorker();
  await closeWebhookQueue();
  await closeRagIngestQueue();
  await closeRagQueueEvents();
  httpServer.close(() => process.exit(0));
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
