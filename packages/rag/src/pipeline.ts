/**
 * RAG 문서 인제스트 파이프라인
 *
 * 흐름:
 *   [임시 파일 경로] → worker_threads [파싱+청킹+임베딩] → DB upsert → tmpfile 삭제
 *
 * 설계 원칙:
 *   - 메인 스레드는 "경로 전달"과 "DB 저장"만 담당
 *   - CPU-bound(파싱/청킹)와 Network I/O(임베딩) 전부 워커 스레드 내부에서 처리
 *   - tmpfile은 성공/실패 무관하게 finally에서 반드시 삭제 (OS tmpdir 오염 방지)
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { unlink } from 'fs/promises';
import { db, ragDocuments } from '@openmento/db';
import type { WorkerInput, WorkerOutput, WorkerError } from './embed-worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── 타입 ─────────────────────────────────────────────────────────────────
export interface IngestOptions {
  institutionId: string;
  courseId?: string;
  fileName: string;   // 원본 파일명 (확장자 판별용)
  filePath: string;   // OS 임시 디렉토리의 물리 파일 경로
  /**
   * 청크 DB 저장 진행률 콜백 (Phase 5-1 개선 ③ — Chunking 컨텍스트 추적)
   *
   * current: 현재까지 저장된 청크 수
   * total:   전체 청크 수
   *
   * BullMQ rag-worker에서 job.updateProgress()로 연결되어
   * QueueEvents → socket.io 'rag:progress' 이벤트로 Admin UI에 실시간 송출됩니다.
   */
  onProgress?: (current: number, total: number) => Promise<void>;
}

export interface IngestResult {
  totalChunks: number;
  savedChunks: number;
  sourceType: string;
  fileName: string;
}

// ─── worker_threads 인제스트 래퍼 ────────────────────────────────────────
/**
 * 워커 스레드에서 파일 읽기 → 파싱 → 청킹 → 임베딩을 모두 처리합니다.
 * 버퍼가 아닌 파일 경로만 전달하므로 메모리 이중 적재를 방지합니다.
 */
function runIngestWorker(input: WorkerInput): Promise<WorkerOutput> {
  return new Promise((resolve, reject) => {
    const workerPath = join(__dirname, 'embed-worker.js');

    const worker = new Worker(workerPath, {
      workerData: input,
      execArgv: ['--import', 'tsx/esm'],
    });

    worker.once('message', (msg: WorkerOutput | WorkerError) => {
      if (msg.success) {
        resolve(msg);
      } else {
        reject(new Error(`[ingest-worker] ${msg.error}`));
      }
    });

    worker.once('error', (err) => reject(err));

    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`[ingest-worker] 비정상 종료: exit code ${code}`));
      }
    });
  });
}

// ─── 메인 파이프라인 ──────────────────────────────────────────────────────
/**
 * 임시 파일 경로를 받아 파싱 → 임베딩(워커) → DB 저장 → tmpfile 삭제까지 실행합니다.
 *
 * @param options 기관 ID, 과목 ID, 파일명, 임시 파일 경로
 * @returns 처리 결과 통계
 */
export async function ingestDocument(
  options: IngestOptions,
): Promise<IngestResult> {
  const { institutionId, courseId, fileName, filePath, onProgress } = options;

  try {
    // 파싱 + 청킹 + 임베딩 — 전부 워커 스레드에서 처리 (메인 루프 블로킹 없음)
    const { chunks, embeddings, sourceType } = await runIngestWorker({
      filePath,
      fileName,
    });

    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        savedChunks: 0,
        sourceType,
        fileName,
      };
    }

    // DB 저장 (배치 크기 50으로 나눠 insert — DB 부하 조절)
    const rows = chunks.map((chunk, i) => ({
      institutionId,
      courseId: courseId ?? null,
      sourceFileName: fileName,
      sourceType,
      chunkIndex: chunk.chunkIndex,
      chunkText: chunk.text,
      embedding: embeddings[i] ?? [],
      pageNumber: chunk.pageNumber ?? null,
      tokenCount: chunk.tokenCount,
    }));

    const BATCH = 50;
    let saved = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      await db.insert(ragDocuments).values(batch);
      saved += batch.length;
      // 진행률 콜백 — BullMQ job.updateProgress()로 연결됩니다 (optional)
      if (onProgress) {
        await onProgress(saved, rows.length);
      }
    }

    return {
      totalChunks: chunks.length,
      savedChunks: saved,
      sourceType,
      fileName,
    };
  } finally {
    // 성공/실패 무관하게 OS tmpdir 임시 파일 반드시 삭제
    await unlink(filePath).catch(() => {
      /* 이미 삭제됐거나 존재하지 않으면 무시 */
    });
  }
}
