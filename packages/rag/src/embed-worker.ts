/**
 * worker_threads 인제스트 워커
 *
 * 메인 서버 스레드 CPU 블로킹을 원천 차단하기 위해
 * 파일 읽기 → 파싱/청킹(CPU-bound) → 임베딩(Network I/O)
 * 전체 파이프라인을 워커 스레드 내부에서 처리합니다.
 *
 * 메시지 프로토콜:
 *   부모 → 워커: WorkerInput  (임시 파일 경로 + 원본 파일명)
 *   워커 → 부모: WorkerOutput (청크 목록 + 벡터 배열)
 */

import { workerData, parentPort } from 'worker_threads';
import { readFile } from 'fs/promises';
import { parseDocument } from './chunker.js';
import { embedBatch } from './embedder.js';
import type { TextChunk, SourceType } from './chunker.js';

// ─── 프로토콜 타입 ─────────────────────────────────────────────────────────
export interface WorkerInput {
  filePath: string; // OS 임시 디렉토리의 물리 파일 경로
  fileName: string; // 원본 파일명 (확장자 판별에 사용)
}

export interface WorkerOutput {
  success: true;
  chunks: TextChunk[];
  embeddings: number[][];
  sourceType: SourceType;
}

export interface WorkerError {
  success: false;
  error: string;
}

// ─── 워커 실행부 ───────────────────────────────────────────────────────────
(async () => {
  if (!parentPort) process.exit(1);

  const input = workerData as WorkerInput;

  try {
    // 1. 디스크에서 파일 읽기 (I/O)
    const buffer = await readFile(input.filePath);

    // 2. 파싱 + 청킹 (CPU-bound — 메인 스레드 블로킹 방지 핵심)
    const { chunks, sourceType } = await parseDocument(buffer, input.fileName);

    if (chunks.length === 0) {
      const output: WorkerOutput = {
        success: true,
        chunks: [],
        embeddings: [],
        sourceType,
      };
      parentPort.postMessage(output);
      return;
    }

    // 3. 배치 임베딩 (Network I/O + 지수 백오프 재시도)
    const texts = chunks.map((c) => c.text);
    const embeddings = await embedBatch(texts);

    const output: WorkerOutput = { success: true, chunks, embeddings, sourceType };
    parentPort.postMessage(output);
  } catch (err) {
    const output: WorkerError = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort.postMessage(output);
  }
})();

