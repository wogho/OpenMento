/**
 * assignments — 강사가 과목에 업로드하는 과제 공지
 *
 * 과제는 커뮤니티 형식의 게시판으로 운영됩니다:
 *  - 강사가 제목·내용·파일·제출기한을 작성
 *  - 해당 과목 수강생 전원에게 채팅 System Message로 알림
 *  - 수강생은 '보기'(공지 이동) 또는 '분석'(AI 에이전트 자동 분석) 선택
 */
import {
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { courses } from './courses.js';
import { adminUsers } from './admin_users.js';
import { assignmentComments } from './assignment_comments.js';

export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  instructorId: uuid('instructor_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  /** 첨부파일 URL (optional) */
  fileUrl: text('file_url'),
  /** 원본 파일명 (표시용) */
  fileName: text('file_name'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('assignments_course_id_idx').on(table.courseId),
  index('assignments_instructor_id_idx').on(table.instructorId),
  index('assignments_deleted_at_idx').on(table.deletedAt),
]);

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  course: one(courses, {
    fields: [assignments.courseId],
    references: [courses.id],
  }),
  instructor: one(adminUsers, {
    fields: [assignments.instructorId],
    references: [adminUsers.id],
  }),
  comments: many(assignmentComments),
}));

export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
