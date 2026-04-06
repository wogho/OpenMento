/**
 * pgvector 코사인 유사도 검색 모듈
 *
 * ragDocuments 테이블에서 질문 임베딩과 유사한 청크를 검색합니다.
 * HNSW 인덱스(vector_cosine_ops)를 활용하므로 수천 청크도 고속 검색 가능합니다.
 */

import { sql, and, isNull } from 'drizzle-orm';
import { db, ragDocuments } from '@educlip/db';
import { embedText } from './embedder.js';

// ─── 타입 ─────────────────────────────────────────────────────────────────
export interface SearchOptions {
  institutionId: string;
  courseId?: string;       // 특정 과목으로 범위 제한
  topK?: number;           // 상위 k개 반환 (기본 3)
  maxDistance?: number;    // 코사인 거리 임계값 (기본 0.4 — 유사도 0.6 이상)
}

export interface SearchResult {
  id: string;
  chunkText: string;
  sourceFileName: string;
  chunkIndex: number;
  pageNumber: number | null;
  distance: number;        // 코사인 거리 (0=완전일치, 2=완전반대)
}

// ─── 벡터 유사도 검색 ─────────────────────────────────────────────────────
/**
 * 질문 텍스트를 임베딩한 뒤 pgvector cosine_distance로 유사 청크를 검색합니다.
 *
 * @param query 수강생 질문 텍스트
 * @param options 검색 옵션 (기관, 과목, topK, 임계값)
 * @returns 유사도 순 정렬된 청크 목록
 */
export async function searchSimilarChunks(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const {
    institutionId,
    courseId,
    topK = 3,
    maxDistance = 0.4,
  } = options;

  // 1. 질문 임베딩 생성
  const queryEmbedding = await embedText(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // 2. pgvector cosine_distance 검색
  //    <=> 연산자: cosine distance (HNSW vector_cosine_ops 인덱스 활용)
  const filters = [
    sql`${ragDocuments.institutionId} = ${institutionId}::uuid`,
    isNull(ragDocuments.deletedAt), // Soft Delete 필터
  ];

  if (courseId) {
    filters.push(sql`${ragDocuments.courseId} = ${courseId}::uuid`);
  }

  const rows = await db
    .select({
      id: ragDocuments.id,
      chunkText: ragDocuments.chunkText,
      sourceFileName: ragDocuments.sourceFileName,
      chunkIndex: ragDocuments.chunkIndex,
      pageNumber: ragDocuments.pageNumber,
      distance: sql<number>`(${ragDocuments.embedding} <=> ${embeddingStr}::vector)`,
    })
    .from(ragDocuments)
    .where(and(...filters))
    .orderBy(sql`${ragDocuments.embedding} <=> ${embeddingStr}::vector`)
    .limit(topK * 2); // 임계값 필터링 후 topK를 맞추기 위해 여유 있게 가져옴

  // 3. 거리 임계값 필터링 + topK 제한
  return rows
    .filter((row) => row.distance <= maxDistance)
    .slice(0, topK);
}

// ─── 컨텍스트 문자열 조합 (프롬프트 삽입용) ─────────────────────────────
/**
 * 검색 결과를 LLM 프롬프트에 삽입할 형태로 포맷합니다.
 *
 * 예시:
 * [1] 파일: Java_기초.pdf, 청크 #3
 * 스프링 MVC 패턴은 Model, View, Controller의 분리를...
 */
export function formatSearchResultsAsContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return '(관련 교재 내용을 찾지 못했습니다.)';
  }

  return results
    .map((r, i) => {
      const location = r.pageNumber
        ? `${r.sourceFileName}, p.${r.pageNumber}`
        : `${r.sourceFileName}, 청크 #${r.chunkIndex}`;
      return `[${i + 1}] 출처: ${location}\n${r.chunkText}`;
    })
    .join('\n\n---\n\n');
}
