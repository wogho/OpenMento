/**
 * OpenAI 임베딩 생성 모듈
 *
 * 모델: text-embedding-3-small (1536 차원)
 * 배치 처리: API 호출 횟수 최소화를 위해 최대 100개 텍스트를 묶어 한 번에 요청
 * Rate Limit 대응: 지수 백오프 재시도 (최대 3회, 1s→2s→4s)
 */

import OpenAI from 'openai';

// ─── 상수 ─────────────────────────────────────────────────────────────────
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 100;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ─── OpenAI 클라이언트 (Fail-Fast) ─────────────────────────────────────────
// worker_threads에서 로드될 때도 동일하게 검증
function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.',
    );
  }
  return new OpenAI({ apiKey });
}

// ─── 지수 백오프 재시도 래퍼 ─────────────────────────────────────────────
/**
 * OpenAI 429 (Rate Limit) / 503 (Service Unavailable) 에 한해 재시도합니다.
 * 재시도 대기: 1s → 2s → 4s (지수 백오프)
 */
async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // OpenAI SDK 에러: status 속성 존재 여부로 판별
      const isRetryable =
        err instanceof OpenAI.APIError &&
        (err.status === 429 || err.status === 503);

      if (!isRetryable || attempt === retries) throw err;

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

// ─── 단일 텍스트 임베딩 ──────────────────────────────────────────────────
export async function embedText(text: string): Promise<number[]> {
  const client = createOpenAIClient();
  const response = await withExponentialBackoff(() =>
    client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  );
  return response.data[0]!.embedding;
}

// ─── 배치 임베딩 ─────────────────────────────────────────────────────────
/**
 * 여러 텍스트를 배치로 임베딩합니다.
 * 반환 순서는 입력 순서와 동일합니다.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = createOpenAIClient();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // 429/503 발생 시 지수 백오프로 자동 재시도
    const response = await withExponentialBackoff(() =>
      client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    );

    // API는 index 필드로 순서를 보장하지만 명시적으로 정렬
    const sorted = response.data.sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));

    // Rate Limit 대응: 마지막 배치가 아닌 경우만 딜레이
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  return results;
}
