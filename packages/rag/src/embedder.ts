/**
 * 멀티 프로바이더 임베딩 생성 모듈
 *
 * 지원 프로바이더:
 *   - openai  : text-embedding-3-small (1536 차원, 네이티브)
 *   - cohere  : embed-multilingual-v3.0 (1024 → 1536 차원 zero-pad)
 *   - google  : gemini-embedding-001   (3072 → outputDimensionality=1536)
 *
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

// ─── 프로바이더 타입 ─────────────────────────────────────────────────────────
export type EmbeddingProvider = 'openai' | 'cohere' | 'google';

// ─── 차원 정규화 유틸 ────────────────────────────────────────────────────────
// DB vector 컬럼이 1536 고정이므로 짧은 벡터는 zero-pad, 긴 벡터는 자름
function normalizeDims(vec: number[], targetDim = EMBEDDING_DIMENSIONS): number[] {
  if (vec.length === targetDim) return vec;
  if (vec.length > targetDim) return vec.slice(0, targetDim);
  return [...vec, ...new Array<number>(targetDim - vec.length).fill(0)];
}

// ─── OpenAI 클라이언트 (Fail-Fast) ─────────────────────────────────────────
// worker_threads에서 로드될 때도 동일하게 검증
function createOpenAIClient(apiKey?: string): OpenAI {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
  }
  return new OpenAI({ apiKey: key });
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

// ─── 단일 텍스트 임베딩 (OpenAI, env key 또는 명시적 apiKey) ───────────────
export async function embedText(text: string, apiKey?: string): Promise<number[]> {
  const client = createOpenAIClient(apiKey);
  const response = await withExponentialBackoff(() =>
    client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  );
  return response.data[0]!.embedding;
}

// ─── OpenAI 배치 임베딩 ───────────────────────────────────────────────────
async function embedBatchOpenAI(texts: string[], apiKey?: string): Promise<number[][]> {
  const client = createOpenAIClient(apiKey);
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await withExponentialBackoff(() =>
      client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    );
    const sorted = response.data.sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));
    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return results;
}

// ─── Cohere 배치 임베딩 ───────────────────────────────────────────────────
// 모델: embed-multilingual-v3.0 (1024차원 → 1536 zero-pad)
async function embedBatchCohere(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // eslint-disable-next-line no-await-in-loop
    const res = await fetch('https://api.cohere.com/v2/embed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'embed-multilingual-v3.0',
        texts: batch,
        input_type: 'search_document',
        embedding_types: ['float'],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Cohere 임베딩 API 오류 (${res.status}): ${errText}`);
    }

    const json = await res.json() as {
      embeddings: { float: number[][] };
    };
    const batchVecs = json.embeddings.float.map((v) => normalizeDims(v));
    results.push(...batchVecs);

    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return results;
}

// ─── Google 배치 임베딩 ───────────────────────────────────────────────────
// 모델: gemini-embedding-001 (3072차원, outputDimensionality=1536으로 직접 제한)
async function embedBatchGoogle(texts: string[], apiKey: string): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // batchEmbedContents API (gemini-embedding-001 은 v1beta 엔드포인트만 지원)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text }] },
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Google 임베딩 API 오류 (${res.status}): ${errText}`);
    }

    const json = await res.json() as {
      embeddings: { values: number[] }[];
    };
    const batchVecs = json.embeddings.map((e) => normalizeDims(e.values));
    results.push(...batchVecs);

    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  return results;
}

// ─── 배치 임베딩 (OpenAI, env key — 기존 호환) ───────────────────────────
/**
 * 여러 텍스트를 배치로 임베딩합니다 (OpenAI, OPENAI_API_KEY 환경변수 사용).
 * 반환 순서는 입력 순서와 동일합니다.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return embedBatchOpenAI(texts);
}

// ─── 멀티 프로바이더 배치 임베딩 ─────────────────────────────────────────
/**
 * 지정된 프로바이더로 배치 임베딩합니다.
 * 모든 결과 벡터는 1536차원으로 정규화됩니다.
 */
export async function embedBatchWithProvider(
  texts: string[],
  provider: EmbeddingProvider,
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  switch (provider) {
    case 'openai':
      return embedBatchOpenAI(texts, apiKey);
    case 'cohere':
      return embedBatchCohere(texts, apiKey);
    case 'google':
      return embedBatchGoogle(texts, apiKey);
    default:
      throw new Error(`지원하지 않는 임베딩 프로바이더: ${String(provider)}`);
  }
}
