import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { courses } from './courses.js';

// 수강생 실명 정보 — 익명 ID와 분리 저장 (개인정보 최소화)
export const students = pgTable('students', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 익명 식별자 (AI 튜터·EWS 등 모든 로직에 사용)
  anonymousId: uuid('anonymous_id').notNull().unique().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .references(() => courses.id, { onDelete: 'set null' }),
  // 실명 정보는 암호화 대상 컬럼 (Phase 5-5 컬럼 레벨 암호화 적용 전 placeholder)
  displayName: text('display_name'), // 마스킹 표시용 (홍*동)
  // Phase 2-5: GitHub Webhook 연동을 위한 GitHub 레포 매핑 컬럼
  // 예: 'student-user/java-assignment-01'  (NULL이면 Webhook 코드 리뷰 미전송)
  githubRepo: text('github_repo'),
  isActive: boolean('is_active').notNull().default(true),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 수강생 개인정보 교육부 5년 보존 지침 대응
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — 기관별·과목별 수강생 조회 최적화
  index('students_institution_id_idx').on(table.institutionId),
  index('students_course_id_idx').on(table.courseId),
  index('students_deleted_at_idx').on(table.deletedAt),
  // Partial Index: 활성(미삭제) 수강생만 대상으로 조회 쫼리 향상
  // deleted_at IS NULL 행만 인덱스에 포함 → EWS / Heartbeat 스캔 시 N배 속도 개선
  // ── 복합 인덱스 (Phase 5-2 ① 개선): RLS + 정렬/필터 플래너 최적화
  // 기관별 등록 순 목록: WHERE institution_id = X AND deleted_at IS NULL ORDER BY enrolled_at DESC
  index('students_institution_enrolled_idx')
    .on(table.institutionId, table.enrolledAt)
    .where(sql`${table.deletedAt} IS NULL`),
  // 기관+과목 필터: WHERE institution_id = X AND course_id = Y AND deleted_at IS NULL
  index('students_institution_course_idx')
    .on(table.institutionId, table.courseId)
    .where(sql`${table.deletedAt} IS NULL`),
  index('students_active_institution_idx')
    .on(table.institutionId)
    .where(sql`${table.deletedAt} IS NULL`),
  // anonymousId 유니크 조건도 partial (soft-delete 후 재등록 허용)
  uniqueIndex('students_anonymous_id_active_idx')
    .on(table.anonymousId)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const studentsRelations = relations(students, ({ one }) => ({
  institution: one(institutions, {
    fields: [students.institutionId],
    references: [institutions.id],
  }),
  course: one(courses, {
    fields: [students.courseId],
    references: [courses.id],
  }),
}));

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
