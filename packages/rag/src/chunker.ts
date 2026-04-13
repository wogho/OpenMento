/**
 * 문서 파싱 및 청킹 모듈
 *
 * 지원 형식: PDF, Markdown, 평문 텍스트
 * 청킹 전략: 512 토큰 단위, 슬라이딩 윈도우 50 토큰 오버랩
 *
 * 토큰 추정: 영문 ~4자/토큰, 한글 ~2자/토큰 → 혼합 문서 대응을 위해
 * 보수적으로 2.5자/토큰으로 계산 (실제 tokenizer 없이 근사)
 */

import pdfParse from 'pdf-parse';

// ─── 상수 ──────────────────────────────────────────────────────────────────
const CHUNK_TOKEN_SIZE = 512;
const OVERLAP_TOKEN_SIZE = 50;
// 한글/영문 혼합 기준 보수적 추정: 평균 2.5자 = 1토큰
const CHARS_PER_TOKEN = 2.5;

const CHUNK_SIZE_CHARS = Math.floor(CHUNK_TOKEN_SIZE * CHARS_PER_TOKEN); // 1280자
const OVERLAP_CHARS = Math.floor(OVERLAP_TOKEN_SIZE * CHARS_PER_TOKEN);  // 125자

// ─── 타입 정의 ────────────────────────────────────────────────────────────
export interface TextChunk {
  text: string;
  chunkIndex: number;
  tokenCount: number;   // 추정 토큰 수
  pageNumber?: number;  // PDF의 경우 페이지 번호
}

export type SourceType = 'pdf' | 'markdown' | 'text';

export interface ParseResult {
  chunks: TextChunk[];
  sourceType: SourceType;
  totalChunks: number;
}

// ─── 토큰 수 추정 ─────────────────────────────────────────────────────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ─── 텍스트 → 청크 분할 ───────────────────────────────────────────────────
/**
 * 슬라이딩 윈도우 방식으로 텍스트를 청킹합니다.
 * 문단 경계(빈 줄)를 존중하여 의미 단위를 최대한 보존합니다.
 */
function splitIntoChunks(
  text: string,
  basePageNumber?: number,
): TextChunk[] {
  const chunks: TextChunk[] = [];

  // 연속 공백/빈 줄 정규화
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (normalized.length === 0) return chunks;

  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const end = start + CHUNK_SIZE_CHARS;
    let slice = normalized.slice(start, end);

    // 청크 중간에서 단어가 잘리지 않도록 마지막 공백 기준으로 조정
    // (마지막 청크가 아닌 경우에만)
    if (end < normalized.length) {
      const lastNewline = slice.lastIndexOf('\n');
      const lastSpace = slice.lastIndexOf(' ');
      const breakPoint = lastNewline > CHUNK_SIZE_CHARS * 0.7
        ? lastNewline
        : lastSpace > CHUNK_SIZE_CHARS * 0.7
          ? lastSpace
          : -1;

      if (breakPoint > 0) {
        slice = slice.slice(0, breakPoint);
      }
    }

    const trimmed = slice.trim();
    if (trimmed.length > 0) {
      chunks.push({
        text: trimmed,
        chunkIndex,
        tokenCount: estimateTokens(trimmed),
        pageNumber: basePageNumber,
      });
      chunkIndex++;
    }

    // 오버랩을 포함한 다음 시작 위치
    const advance = slice.length - OVERLAP_CHARS;
    start += advance > 0 ? advance : slice.length;
  }

  return chunks;
}

// ─── PDF 파싱 ─────────────────────────────────────────────────────────────
export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const data = await pdfParse(buffer);
  const fullText = data.text;

  // pdf-parse는 페이지별 텍스트를 제공하지 않으므로 전체 텍스트를 청킹
  // pageNumber는 추정 불가 — undefined 처리
  const chunks = splitIntoChunks(fullText);

  return {
    chunks,
    sourceType: 'pdf',
    totalChunks: chunks.length,
  };
}

// ─── Markdown 파싱 ────────────────────────────────────────────────────────
/**
 * Markdown을 헤더(##, ###) 기준으로 섹션 분리 후 청킹합니다.
 * 섹션이 CHUNK_SIZE_CHARS보다 작으면 그대로 1개 청크로 처리합니다.
 */
export function parseMarkdown(text: string): ParseResult {
  // ## 또는 ### 헤더 기준으로 섹션 분리
  const sections = text.split(/(?=\n#{1,3} )/);
  const chunks: TextChunk[] = [];
  let globalIndex = 0;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= CHUNK_SIZE_CHARS) {
      chunks.push({
        text: trimmed,
        chunkIndex: globalIndex++,
        tokenCount: estimateTokens(trimmed),
      });
    } else {
      // 섹션이 크면 슬라이딩 윈도우 청킹
      const subChunks = splitIntoChunks(trimmed);
      for (const sub of subChunks) {
        chunks.push({ ...sub, chunkIndex: globalIndex++ });
      }
    }
  }

  return {
    chunks,
    sourceType: 'markdown',
    totalChunks: chunks.length,
  };
}

// ─── 평문 파싱 ────────────────────────────────────────────────────────────
export function parsePlainText(text: string): ParseResult {
  const chunks = splitIntoChunks(text);
  return {
    chunks,
    sourceType: 'text',
    totalChunks: chunks.length,
  };
}

// ─── 통합 파서 ────────────────────────────────────────────────────────────
export async function parseDocument(
  buffer: Buffer,
  fileName: string,
): Promise<ParseResult> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';

  if (ext === 'pdf') {
    return parsePdf(buffer);
  } else if (ext === 'md' || ext === 'markdown') {
    return parseMarkdown(buffer.toString('utf-8'));
  } else {
    return parsePlainText(buffer.toString('utf-8'));
  }
}
