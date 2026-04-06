import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  customType,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { courses } from './courses.js';

// pgvector vector 타입 커스텀 정의
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    // config is undefined by default, but we need a dimension
    const dim = (config as unknown as { dimensions?: number })?.dimensions ?? 1536;
    return `vector(${dim})`;
  },
  fromDriver(value: string): number[] {
    // [0.1,0.2,...] 형태 파싱
    return value
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
});

export const ragDocuments = pgTable('rag_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .references(() => courses.id, { onDelete: 'set null' }),
  // 원본 파일 정보
  sourceFileName: text('source_file_name').notNull(),
  sourceType: text('source_type').notNull(), // 'pdf', 'markdown', 'text'
  // 청킹 정보
  chunkIndex: integer('chunk_index').notNull(),
  chunkText: text('chunk_text').notNull(),
  // pgvector 임베딩 (text-embedding-3-small: 1536 차원)
  embedding: vector('embedding', { dimensions: 1536 } as unknown as undefined),
  // 메타데이터
  pageNumber: integer('page_number'),
  tokenCount: integer('token_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 교육부 5년 보존 지침 대응
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // HNSW 벡터 인덱스 — 코사인 유사도 검색 고속화 (수백~수천 청크 대응)
  index('rag_documents_embedding_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops'))
    .with({ m: 16, ef_construction: 64 }),
  // FK 인덱스 — 기관별·과목별 청크 조회 최적화
  index('rag_documents_institution_id_idx').on(table.institutionId),
  index('rag_documents_course_id_idx').on(table.courseId),
  // Soft Delete 필터링 인덱스
  index('rag_documents_deleted_at_idx').on(table.deletedAt),
]);

export const ragDocumentsRelations = relations(ragDocuments, ({ one }) => ({
  institution: one(institutions, {
    fields: [ragDocuments.institutionId],
    references: [institutions.id],
  }),
  course: one(courses, {
    fields: [ragDocuments.courseId],
    references: [courses.id],
  }),
}));

export type RagDocument = typeof ragDocuments.$inferSelect;
export type NewRagDocument = typeof ragDocuments.$inferInsert;
