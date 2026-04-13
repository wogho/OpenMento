import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import authRouter from './routes/auth.js';
import studentRouter from './routes/student.js';
import instructorRouter from './routes/instructor.js';
import adminRouter from './routes/admin.js';
import webhookRouter from './routes/webhook.js';
import lmsWebhookRouter from './routes/lms-webhook.js';
import portfolioRouter from './routes/portfolio.js';
import superAdminRouter from './routes/super-admin.js';
import onboardingRouter from './routes/onboarding.js';
import setupRouter from './routes/setup.js';
import assignmentsRouter from './routes/assignments.js';
import portfolioPostsRouter from './routes/portfolio-posts.js';
import attendanceRouter from './routes/attendance.js';
import { createBullBoardRouter, BULL_BOARD_BASE_PATH } from './routes/bull-board.js';
import { createSocketServer } from './socket/chat.handler.js';
import { startHeartbeatScheduler, stopHeartbeatScheduler } from './services/heartbeat.js';
import { startHeartbeatProactiveScheduler } from './services/heartbeat-proactive.js';
import { startWebhookWorker, closeWebhookWorker } from './queues/webhook.worker.js';
import { initEwsThresholdsDb, loadEwsThresholdsFromDb } from './services/ews-thresholds.js';
import { initInstitutionSettingsDb, loadAllInstitutionSettings } from './services/institution-settings-service.js';
import { loadDefaultSkills, watchSkillFiles } from './services/skill-registry.js';
import { closeWebhookQueue } from './queues/webhook.queue.js';
import { closeRagIngestQueue } from './queues/rag-ingest.queue.js';
import { startRagQueueEvents, closeRagQueueEvents } from './queues/rag-queue-events.js';
import { rlsErrorHandler } from './utils/tenant-assert.js';
import { logger } from './utils/logger.js';
import { authLimiter, adminLimiter, chatLimiter, webhookLimiter } from './middleware/rateLimiter.js';
import { securityHeaders } from './middleware/security-headers.js';
import * as Sentry from '@sentry/node';
import { getMetrics, requestCounter, apiResponseTimeHistogram } from './utils/metrics.js';
import { sendSystemErrorToSlack } from './services/slack-notifier.js';

const app = express();

// Codespaces/Ingress 환경에서는 X-Forwarded-* 헤더가 기본 포함됩니다.
// 첫 번째 프록시 홉만 신뢰해 rate-limit 우회 위험을 낮춥니다.
app.set('trust proxy', 1);

const httpServer = createServer(app);

// ── HTTP Metrics Middleware (Phase 6-2) ──────────────────────
app.use((req, res, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const time = diff[0] + diff[1] / 1e9;
    const route = req.route ? req.route.path : req.path;
    requestCounter.inc({ method: req.method, route, status_code: res.statusCode });
    apiResponseTimeHistogram.observe({ method: req.method, route, status_code: res.statusCode }, time);
  });
  next();
});

// ── OWASP A05 보안 헤더 (Phase 5-5) — 모든 라우트 앞에 적용 ─────────────────
app.use(securityHeaders);

app.use(express.json());

// ── Prometheus Metrics Endpoint (Phase 6-2) ────────────────────────
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', 'text/plain');
    res.end(await getMetrics());
  } catch (err) {
    res.status(500).end(String(err));
  }
});

// ── 정적 파일 서빙: 과제 첨부파일 ────────────────────────────────────────────
const ASSIGN_UPLOAD_DIR = process.env.ASSIGN_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads', 'assignments');
mkdirSync(ASSIGN_UPLOAD_DIR, { recursive: true });
app.use('/uploads/assignments', express.static(ASSIGN_UPLOAD_DIR));

// ── 정적 파일 서빙: 포트폴리오 첨부파일 ──────────────────────────────────────────
const PORTFOLIO_UPLOAD_DIR = process.env.PORTFOLIO_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads', 'portfolios');
mkdirSync(PORTFOLIO_UPLOAD_DIR, { recursive: true });
app.use('/uploads/portfolios', express.static(PORTFOLIO_UPLOAD_DIR));

// ── GitHub Webhook: raw Buffer 파싱 (HMAC 서명 검증에 원본 바이트 필요) ──────
// express.json() 적용 전에 등록해야 충돌 없음
app.use(
  '/webhook',
  express.raw({ type: 'application/json', limit: '5mb' }),
  webhookLimiter,
  webhookRouter,
);

// ── LMS Webhook: LMS → OpenMento Push 수신 (출결/성적 이벤트) ────────────────
// raw Buffer 로 파싱하여 HMAC-SHA256 서명 검증에 사용합니다.
app.use(
  '/lms-webhook',
  express.raw({ type: 'application/json', limit: '2mb' }),
  // rawBody를 req에 주입하여 라우터에서 서명 검증에 활용
  (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) {
      (req as unknown as Record<string, unknown>).rawBody = req.body;
      try {
        req.body = JSON.parse(req.body.toString('utf-8'));
      } catch {
        req.body = {};
      }
    }
    next();
  },
  webhookLimiter,
  lmsWebhookRouter,
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

// ── 초기 설치 라우터 (공개, 미초기화 상태에만 동작) ────────────
app.use('/setup', authLimiter, setupRouter);

// ── RBAC 보호 라우터 ──────────────────────────────────────
// plan.md 부록 B: /student/* /instructor/* /admin/* 라우트 분리
app.use('/student', chatLimiter, studentRouter);
app.use('/instructor', adminLimiter, instructorRouter);
app.use('/admin', adminLimiter, adminRouter);
app.use('/portfolio', chatLimiter, portfolioRouter);
app.use('/assignments', chatLimiter, assignmentsRouter);
app.use('/portfolio-posts', chatLimiter, portfolioPostsRouter);
app.use('/attendance', chatLimiter, attendanceRouter);
// Phase 5-3: 온보딩 투어 완료 상태 관리
app.use('/onboarding', chatLimiter, onboardingRouter);
// 기관 관리 통일. /admin/institutions 등으로 사용 예정이지만 기존 엔드포인트 유지 용도
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

// ── Sentry Error Handler (Phase 6-2) ─────────────────────
Sentry.setupExpressErrorHandler(app);

// ── 전역 에러 핸들러 ─────────────────────────────────────
// multer 파일 크기 초과, 파일 형식 오류, 기타 uncaught 에러 처리
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
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
  
  const slackUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (slackUrl) {
    sendSystemErrorToSlack(slackUrl, err, { route: req.path, method: req.method }).catch(() => {});
  }
  
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

const PORT = Number(process.env.PORT) || 3000;

// Socket.io 서버 초기화 (chat.handler.ts)
createSocketServer(httpServer);

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, '[api] OpenMento server listening');
  // ── 기본 에이전트 스킬 레지스트리 로드 ─────────────────────────────
  loadDefaultSkills();
  watchSkillFiles();
  // ── EWS 임계치 DB 연결 + 프리워밍 (Phase 2 개선: 영속성 확보) ─
  // DB 인스턴스를 주입하고 저장된 모든 기관 임계치를 캐시에 적재합니다.
  // DB 접근 실패 시 기본값(60/75/90)으로 폴백하므로 서버 기동이 중단되지 않습니다.
  void (async () => {
    const { db } = await import('@openmento/db');
    initEwsThresholdsDb(db);
    await loadEwsThresholdsFromDb();
    logger.info('[ews-thresholds] DB 프리워밍 완료');
    // ── institution_settings 프리워밍 + 서버 재시작 시 secrets 복원 ─
    initInstitutionSettingsDb(db);
    await loadAllInstitutionSettings();
    logger.info('[institution-settings] DB 프리워밍 완료');
    // ── DB에 저장된 API 키를 process.env에 복원 (모든 기관 순회) ─────────
    // tsx watch 재시작 시 런타임에만 설정된 env var가 사라지는 문제를 방지합니다.
    // tutor-agent는 매 요청 시 secrets를 직접 읽으므로 이 복원은 EWS 등
    // 기관 컨텍스트 없이 env를 읽는 서비스(포트폴리오, EWS 모니터 등)를 위한 폴백입니다.
    type SecretsRecord = Record<string, string | undefined>;
    const { institutionSettings, eq: eqOp } = await import('@openmento/db');
    const allSecretRows = await db
      .select({ institutionId: institutionSettings.institutionId, settingValue: institutionSettings.settingValue })
      .from(institutionSettings)
      .where(eqOp(institutionSettings.settingKey, 'secrets'));
    /** 마스킹 문자(•, U+2022)가 포함된 값은 env에 절대 설정하지 않음 */
    const isSafeKey = (v: string | undefined): v is string =>
      typeof v === 'string' && v.length > 0 && !v.includes('\u2022');
    for (const row of allSecretRows) {
      const s = (row.settingValue ?? {}) as SecretsRecord;
      if (isSafeKey(s['openaiApiKey']))    process.env.OPENAI_API_KEY = s['openaiApiKey'];
      if (isSafeKey(s['anthropicApiKey'])) process.env.ANTHROPIC_API_KEY = s['anthropicApiKey'];
      if (isSafeKey(s['openclawApiKey']))  process.env.OPENCLAW_API_KEY = s['openclawApiKey'];
      if (isSafeKey(s['slackWebhookUrl'])) process.env.SLACK_WEBHOOK_URL = s['slackWebhookUrl'];
      if (isSafeKey(s['geminiApiKey'])) {
        process.env.GEMINI_API_KEY   = s['geminiApiKey'];
        process.env.GOOGLE_API_KEY   = s['geminiApiKey'];
        process.env.GOOGLE_AI_API_KEY = s['geminiApiKey'];
      }
      if (isSafeKey(s['ragGoogleApiKey'])) process.env.RAG_GOOGLE_API_KEY = s['ragGoogleApiKey'];
      logger.info({ institutionId: row.institutionId }, '[secrets] process.env 복원 완료');
    }
  })();
  // ── Heartbeat 스케줄러 기동 (Phase 2-1) ─────────────────────
  startHeartbeatScheduler();
  // ── Heartbeat 프로액티브 스캔 기동 (AI 자율 발화) ────────────
  startHeartbeatProactiveScheduler();
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
