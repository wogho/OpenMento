import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { students } from './students.js';
import { courses } from './courses.js';

/**
 * 강사 상담 피드백 감성 분류
 *  - positive: 긍정 (문제없음, 의욕 있음)
 *  - neutral:  중립 (관찰 중)
 *  - negative: 부정 (어려움 호소, 결석 우려, 탈락 위험 신호)
 *
 * EWS 위험 점수 15% 반영: 최근 2주 내 'negative' 기록 1건 이상 시 max 감점
 */
export const counselingSentimentEnum = pgEnum('counseling_sentiment', [
  'positive',
  'neutral',
  'negative',
]);

/**
 * counseling_notes — 강사 상담 이력 테이블
 *
 * 강사가 수강생과 면담·상담한 내용을 기록합니다.
 * EWS phase 2-2 에서 위험 점수 산출 시 최근 2주 이내 'negative' 기록 여부를 조회합니다.
 * Human-in-the-loop 피드백 데이터 수집 기반이기도 합니다.
 */
export const counselingNotes = pgTable(
  'counseling_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    // 상담 감성 분류 (EWS 점수 반영 핵심 필드)
    sentiment: counselingSentimentEnum('sentiment').notNull().default('neutral'),
    // 상담 내용 요약 (개인정보 최소화 — 구체적 실명·번호 기재 금지)
    summary: text('summary'),
    // 상담 일시 (기본: 레코드 생성 시각)
    counseledAt: timestamp('counseled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Soft Delete — 상담 이력 교육부 5년 보존 지침 대응
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // FK 인덱스 — EWS 최근 2주 negative 조회 최적화
    index('counseling_notes_student_id_idx').on(table.studentId),
    index('counseling_notes_course_id_idx').on(table.courseId),
    // 날짜 범위 쿼리 최적화 (최근 2주 상담 이력 스캔)
    index('counseling_notes_counseled_at_idx').on(table.counseledAt),
    index('counseling_notes_deleted_at_idx').on(table.deletedAt),
  ],
);

export const counselingNotesRelations = relations(counselingNotes, ({ one }) => ({
  student: one(students, {
    fields: [counselingNotes.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [counselingNotes.courseId],
    references: [courses.id],
  }),
}));

export type CounselingNote = typeof counselingNotes.$inferSelect;
export type NewCounselingNote = typeof counselingNotes.$inferInsert;
