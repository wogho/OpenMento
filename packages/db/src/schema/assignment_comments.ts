/**
 * assignment_comments — 과제 공지에 달리는 댓글 (강사·수강생 모두 작성 가능)
 *
 * 스레드형 토론을 지원합니다:
 *  - parentId가 NULL이면 최상위 댓글
 *  - parentId가 있으면 대댓글(1 depth)
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
import { assignments } from './assignments.js';
import { adminUsers } from './admin_users.js';
import { students } from './students.js';

export const commentAuthorRoleEnum = pgEnum('comment_author_role', ['instructor', 'student']);

export const assignmentComments = pgTable('assignment_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id')
    .notNull()
    .references(() => assignments.id, { onDelete: 'cascade' }),
  /** 강사가 작성한 경우 */
  instructorId: uuid('instructor_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  /** 수강생이 작성한 경우 */
  studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
  authorRole: commentAuthorRoleEnum('author_role').notNull(),
  content: text('content').notNull(),
  /** 대댓글용 — NULL이면 최상위 */
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('assignment_comments_assignment_id_idx').on(table.assignmentId),
  index('assignment_comments_student_id_idx').on(table.studentId),
  index('assignment_comments_instructor_id_idx').on(table.instructorId),
]);

export const assignmentCommentsRelations = relations(assignmentComments, ({ one }) => ({
  assignment: one(assignments, {
    fields: [assignmentComments.assignmentId],
    references: [assignments.id],
  }),
  instructor: one(adminUsers, {
    fields: [assignmentComments.instructorId],
    references: [adminUsers.id],
  }),
  student: one(students, {
    fields: [assignmentComments.studentId],
    references: [students.id],
  }),
}));

export type AssignmentComment = typeof assignmentComments.$inferSelect;
export type NewAssignmentComment = typeof assignmentComments.$inferInsert;
