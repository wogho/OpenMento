import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  date,
  index,
  smallint,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { students } from './students.js';
import { courses } from './courses.js';
import { adminUsers } from './admin_users.js';

export const attendanceStatusEnum = pgEnum('attendance_status', [
  'present',
  'absent',
  'late',
  'excused',
]);

// ── 출석 세션 (강사가 열어주는 단위) ──────────────────────────────────────
export const attendanceSessions = pgTable('attendance_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  instructorId: uuid('instructor_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),
  weekNo: smallint('week_no').notNull(),
  sessionNo: smallint('session_no').notNull(),
  sessionDate: date('session_date').notNull(),
  isOpen: boolean('is_open').notNull().default(true),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

// ── QR 토큰 (일회성, 만료) ─────────────────────────────────────────────────
export const qrTokens = pgTable('qr_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedCount: smallint('used_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceLogs = pgTable('attendance_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  attendanceDate: date('attendance_date').notNull(),
  weekNo: smallint('week_no'),
  sessionNo: smallint('session_no'),
  checkMethod: text('check_method').default('manual'), // 'manual' | 'self' | 'qr'
  recordedBy: uuid('recorded_by'), // instructor id or student id
  status: attendanceStatusEnum('status').notNull(),
  // MCP 외부 연동 출처 (audit_logs 연계)
  sourceSystem: text('source_system'), // 'lms', 'manual', 'mcp'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 출결 기록 교육부 5년 보존 지침 대응
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — EWS 점수 산출 쿼리의 수강생별·과목별 집계 최적화
  index('attendance_logs_student_id_idx').on(table.studentId),
  index('attendance_logs_course_id_idx').on(table.courseId),
  // 날짜 범위 쿼리 인덱스 (최근 5일 출결 스캔)
  index('attendance_logs_attendance_date_idx').on(table.attendanceDate),
  index('attendance_logs_deleted_at_idx').on(table.deletedAt),
  // Partial Index: 미삭제 출결 로그멖4만 대상으로 EWS Batch 쿼리 쫼리
  // 개선 전만해도 N 배수의 수강생이 있을 때 soft-delete 행 누락 가능
  // 참고: attendance_date 가 text/date 타입이뮼로 인덱스는 B-tree 기본적용
  index('attendance_logs_active_date_idx')
    .on(table.attendanceDate)
    .where(sql`${table.deletedAt} IS NULL`),
  // 주석: 수강생 50명 초과 시 attendance_logs 로우 급증 예상
  //   → Phase 5-A 이후 attendance_date 기준 월별 RANGE PARTITION 적용 결정
  //   → 'CREATE TABLE attendance_logs PARTITION BY RANGE (attendance_date)'
]);

export const attendanceLogsRelations = relations(attendanceLogs, ({ one }) => ({
  student: one(students, {
    fields: [attendanceLogs.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [attendanceLogs.courseId],
    references: [courses.id],
  }),
}));

export const attendanceSessionsRelations = relations(attendanceSessions, ({ one, many }) => ({
  course: one(courses, { fields: [attendanceSessions.courseId], references: [courses.id] }),
  instructor: one(adminUsers, { fields: [attendanceSessions.instructorId], references: [adminUsers.id] }),
  qrTokens: many(qrTokens),
}));

export const qrTokensRelations = relations(qrTokens, ({ one }) => ({
  session: one(attendanceSessions, { fields: [qrTokens.sessionId], references: [attendanceSessions.id] }),
}));

export type AttendanceLog = typeof attendanceLogs.$inferSelect;
export type NewAttendanceLog = typeof attendanceLogs.$inferInsert;
export type AttendanceSession = typeof attendanceSessions.$inferSelect;
export type QrToken = typeof qrTokens.$inferSelect;
