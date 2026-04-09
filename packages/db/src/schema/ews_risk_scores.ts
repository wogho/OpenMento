import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { students } from './students.js';
import { courses } from './courses.js';

export const ewsRiskScores = pgTable('ews_risk_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ── 멀티 테넌트 직접 참조 (0010 마이그레이션: institution_id 컬럼 추가)
  // RLS 정책이 students 서브쿼리 없이 직접 비교할 수 있도록 비정규화
  institutionId: uuid('institution_id')
    .references(() => institutions.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  // 총점 0~100
  totalScore: integer('total_score').notNull(),
  // 세부 점수 상세 { attendance: 30, assignment: 25, counseling: 10, tutorUsage: 8 }
  componentScores: jsonb('component_scores').notNull(),
  // Human-in-the-loop: 강사 오탐 피드백
  isFalsePositive: jsonb('is_false_positive').$type<boolean | null>().default(null),
  instructorNote: text('instructor_note'),
  calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — EWS 대시보드 수강생별·과목별 위험 점수 이력 조회 최적화
  index('ews_risk_scores_student_id_idx').on(table.studentId),
  index('ews_risk_scores_course_id_idx').on(table.courseId),
  // 최근 점수 조회를 위한 시간 인덱스
  index('ews_risk_scores_calculated_at_idx').on(table.calculatedAt),
  // ── 복합 인덱스 (Phase 5-2 ① 개선): RLS institution_id 직접 비교 성능 향상
  index('ews_risk_scores_institution_id_idx').on(table.institutionId),
  // 기관별 고위험 수강생 조회: WHERE institution_id = X ORDER BY total_score DESC
  index('ews_risk_scores_institution_score_idx').on(table.institutionId, table.totalScore),
  // 수강생 최신 점수 이력: WHERE student_id = X ORDER BY calculated_at DESC
  index('ews_risk_scores_student_calculated_idx').on(table.studentId, table.calculatedAt),
]);

export const ewsRiskScoresRelations = relations(ewsRiskScores, ({ one }) => ({
  institution: one(institutions, {
    fields: [ewsRiskScores.institutionId],
    references: [institutions.id],
  }),
  student: one(students, {
    fields: [ewsRiskScores.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [ewsRiskScores.courseId],
    references: [courses.id],
  }),
}));

export type EwsRiskScore = typeof ewsRiskScores.$inferSelect;
export type NewEwsRiskScore = typeof ewsRiskScores.$inferInsert;
