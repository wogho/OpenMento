/**
 * rag-worker/src/index.ts — RAG 임베딩 BullMQ Worker 엔트리포인트
 *
 * plan.md Phase 5-A: 독립 프로세스로 실행되는 RAG 임베딩 워커
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────────
 *
 *   API 서버(POST /admin/documents)가 BullMQ 큐에 추가한 임베딩 Job을 소비합니다.
 *   `ingestDocument()` (@openmento/rag)를 호출하여:
 *     1. OS 공유 볼륨에서 파일 읽기
 *     2. worker_threads 내에서 파싱 + 청킹 (CPU-bound)
 *     3. OpenAI 임베딩 생성 (Network I/O, 지수 백오프)
 *     4. PostgreSQL rag_documents 테이블에 배치 저장
 *     5. 공유 볼륨 임시 파일 삭제
 *
 * ── 실행 환경 변수 ─────────────────────────────────────────────────────────────
 *
 *   REDIS_URL      — Redis 연결 URL (필수)
 *   DATABASE_URL   — PostgreSQL 연결 URL (필수)
 *   OPENAI_API_KEY — 기본 OpenAI API 키 (OpenAI 선택 시 fallback)
 *   UPLOAD_TMP_DIR — API 서버와 공유하는 임시 파일 볼륨 경로 (기본: /tmp)
 *
 * ── 재시도 정책 ────────────────────────────────────────────────────────────────
 *
 *   BullMQ defaultJobOptions (rag-ingest.queue.ts에서 설정):
 *     attempts: 3 (최초 1 + 재시도 2)
 *     backoff: exponential, delay 5000ms (5s→10s→20s)
 *   → OpenAI Rate Limit(429) 대응
 */

import { Worker, UnrecoverableError } from 'bullmq';
import pino from 'pino';
import { createServer } from 'node:http';
import { ingestDocument } from '@openmento/rag';

const logger = pino({
  name: 'rag-worker',
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// ── 필수 환경변수 검증 (Fail-Fast) ─────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  logger.fatal('REDIS_URL 환경변수가 설정되지 않았습니다. rag-worker를 시작할 수 없습니다.');
  process.exit(1);
}

const RAG_INGEST_QUEUE_NAME = 'rag-ingest';

// ── Redis 연결 설정 ────────────────────────────────────────────────────────────
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

// ── BullMQ Worker ─────────────────────────────────────────────────────────────
const worker = new Worker<{
  institutionId: string;
  courseId?: string;
  category?: string;
  tags?: string[];
  enableRag?: boolean;
  embeddingProvider?: 'openai' | 'cohere' | 'google';
  embeddingApiKey?: string;
  fileName: string;
  filePath: string;
  deliveryId: string;
}>(
  RAG_INGEST_QUEUE_NAME,
  async (job) => {
    const {
      institutionId,
      courseId,
      category,
      tags,
      enableRag,
      embeddingProvider,
      embeddingApiKey,
      fileName,
      filePath,
      deliveryId,
    } = job.data;

    logger.info(
      { jobId: job.id, deliveryId, fileName, institutionId, attempt: job.attemptsMade + 1 },
      '[rag-worker] 임베딩 Job 처리 시작',
    );

    // 필수 필드 검증 — 잘못된 데이터는 재시도 무의미하므로 UnrecoverableError
    if (!institutionId || !fileName || !filePath) {
      throw new UnrecoverableError(
        `[rag-worker] Job 데이터 누락 (jobId=${job.id}, deliveryId=${deliveryId})`,
      );
    }

    const startMs = Date.now();
    const result = await ingestDocument({
      institutionId,
      courseId,
      category,
      tags,
      fileName,
      filePath,
      enableRag,
      embeddingProvider,
      embeddingApiKey,
      // ── Phase 5-1 개선 ③: DB 배치 저장마다 진행률 갱신 ──────────────────
      // QueueEvents → socket.io 'rag:progress' → Admin 대시보드 진행률 바 업데이트
      onProgress: async (current, total) => {
        await job.updateProgress({
          current,
          total,
          institutionId,
          deliveryId,
          phase: 'db_save' as const,
        });
      },
    });

    const durationMs = Date.now() - startMs;
    logger.info(
      { jobId: job.id, deliveryId, ...result, durationMs },
      '[rag-worker] 임베딩 Job 완료',
    );
  },
  {
    connection: parseRedisUrl(REDIS_URL),
    concurrency: Number(process.env.RAG_WORKER_CONCURRENCY ?? '2'),
    // 재시도 시 Job 실패 로그
  },
);

worker.on('failed', (job, err) => {
  logger.error(
    {
      jobId: job?.id,
      deliveryId: job?.data?.deliveryId,
      fileName: job?.data?.fileName,
      attemptsMade: job?.attemptsMade,
      err,
    },
    '[rag-worker] Job 실패',
  );
});

worker.on('error', (err) => {
  logger.error({ err }, '[rag-worker] Worker 오류');
});

logger.info(
  {
    queue: RAG_INGEST_QUEUE_NAME,
    concurrency: process.env.RAG_WORKER_CONCURRENCY ?? '2',
    redis: REDIS_URL.replace(/:\/\/.*@/, '://***@'),
  },
  '[rag-worker] Worker 시작',
);

// ── Phase 5-1 개선 ②: HTTP 헬스 서버 (수평 확장 준비) ────────────────────────
//
//   Docker Compose Healthcheck 및 Load Balancer 생존 확인에 사용됩니다.
//   docker compose up --scale rag-worker=3 으로 수평 확장 시 각 인스턴스의 상태를
//   독립적으로 점검할 수 있습니다.
//
//   GET http://localhost:3001/health → 200 { status: "ok" }
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? '3001');
let workerReady = false;
worker.on('ready', () => { workerReady = true; });

const healthServer = createServer((_req, res) => {
  if (workerReady || worker.isRunning()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', queue: RAG_INGEST_QUEUE_NAME }));
  } else {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'starting' }));
  }
});
healthServer.listen(HEALTH_PORT, () => {
  logger.info({ port: HEALTH_PORT }, '[rag-worker] 헬스 서버 시작');
});

// ── 정상 종료 ─────────────────────────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — rag-worker 종료 중...`);
  healthServer.close();
  await worker.close();
  logger.info('[rag-worker] 종료 완료');
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
