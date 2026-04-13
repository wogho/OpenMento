/**
 * 상담 예약 테이블 (consultation_bookings)
 *
 * EWS 위험 점수가 임계치(90점 이상)를 초과할 때 자동 생성되는 전화 상담 예약 레코드.
 * 원장 또는 상담사가 확인 후 confirmations → completions 처리합니다.
 *
 * plan.md Phase 2-4: 상담 예약 자동 생성 API 구현
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { students } from './students.js';
import { courses } from './courses.js';
import { ewsRiskScores } from './ews_risk_scores.js';

export const consultationStatusEnum = pgEnum('consultation_status', [
  'pending',    // 자동 생성됨 — 담당자 확인 대기
  'confirmed',  // 담당자가 일정 확인
  'completed',  // 상담 완료
  'cancelled',  // 취소됨
]);

export const consultationBookings = pgTable(
  'consultation_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    /** EWS 위험 점수 레코드 — 어느 점수가 이 예약을 트리거했는지 추적 */
    triggeredByScoreId: uuid('triggered_by_score_id')
      .references(() => ewsRiskScores.id, { onDelete: 'set null' }),
    status: consultationStatusEnum('status').notNull().default('pending'),
    /** 자동 생성 시각 */
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** 상담 완료 시각 (completed 전환 시 기록) */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** 상담 메모 (원장/상담사 입력) */
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('consultation_bookings_institution_id_idx').on(table.institutionId),
    index('consultation_bookings_student_id_idx').on(table.studentId),
    index('consultation_bookings_status_idx').on(table.status),
    index('consultation_bookings_requested_at_idx').on(table.requestedAt),
  ],
);

export const consultationBookingsRelations = relations(consultationBookings, ({ one }) => ({
  institution: one(institutions, {
    fields: [consultationBookings.institutionId],
    references: [institutions.id],
  }),
  student: one(students, {
    fields: [consultationBookings.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [consultationBookings.courseId],
    references: [courses.id],
  }),
  triggeredByScore: one(ewsRiskScores, {
    fields: [consultationBookings.triggeredByScoreId],
    references: [ewsRiskScores.id],
  }),
}));

export type ConsultationBooking = typeof consultationBookings.$inferSelect;
export type NewConsultationBooking = typeof consultationBookings.$inferInsert;
