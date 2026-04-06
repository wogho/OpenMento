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
import { students } from './students.js';
import { courses } from './courses.js';

export const ewsRiskScores = pgTable('ews_risk_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
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
]);

export const ewsRiskScoresRelations = relations(ewsRiskScores, ({ one }) => ({
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
