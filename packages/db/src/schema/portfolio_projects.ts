import {
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  pgEnum,
  customType,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { students } from './students.js';
import { courses } from './courses.js';
import { institutions } from './institutions.js';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    const dim = (config as unknown as { dimensions?: number })?.dimensions ?? 1536;
    return `vector(${dim})`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
});

export const portfolioStatusEnum = pgEnum('portfolio_status', [
  'draft',
  'interview',
  'planning',
  'security_review',
  'similarity_check',
  'approved',
]);

export const portfolioProjects = pgTable('portfolio_projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  title: text('title'),
  proposalText: text('proposal_text'),
  techStack: text('tech_stack'),
  status: portfolioStatusEnum('status').notNull().default('draft'),
  // 최종 독창성 점수 (유사도 분석 결과: 낮을수록 독창적)
  similarityScore: real('similarity_score'),
  // 기획서 임베딩 (유사도 비교용)
  embedding: vector('embedding', { dimensions: 1536 } as unknown as undefined),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 수강생 포트폴리오 이력 보존
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // HNSW 벡터 인덱스 — 포트폴리오 유사도 비교 고속화
  index('portfolio_projects_embedding_hnsw_idx')
    .using('hnsw', table.embedding.op('vector_cosine_ops'))
    .with({ m: 16, ef_construction: 64 }),
  // FK 인덱스 — 수강생별·과목별·기관별 조회 최적화
  index('portfolio_projects_student_id_idx').on(table.studentId),
  index('portfolio_projects_course_id_idx').on(table.courseId),
  index('portfolio_projects_institution_id_idx').on(table.institutionId),
  index('portfolio_projects_deleted_at_idx').on(table.deletedAt),
]);

export const portfolioProjectsRelations = relations(portfolioProjects, ({ one }) => ({
  student: one(students, {
    fields: [portfolioProjects.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [portfolioProjects.courseId],
    references: [courses.id],
  }),
  institution: one(institutions, {
    fields: [portfolioProjects.institutionId],
    references: [institutions.id],
  }),
}));

export type PortfolioProject = typeof portfolioProjects.$inferSelect;
export type NewPortfolioProject = typeof portfolioProjects.$inferInsert;
