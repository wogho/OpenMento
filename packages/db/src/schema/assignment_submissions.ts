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

export const submissionStatusEnum = pgEnum('submission_status', [
  'submitted',
  'late',
  'missing',
  'graded',
]);

export const assignmentSubmissions = pgTable('assignment_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  assignmentTitle: text('assignment_title').notNull(),
  status: submissionStatusEnum('status').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  githubRepoUrl: text('github_repo_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 과제 이력 교육부 5년 보존 지침 대응
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — EWS 미제출 감지 쿼리 (최근 3개 중 2개 미제출) 최적화
  index('assignment_submissions_student_id_idx').on(table.studentId),
  index('assignment_submissions_course_id_idx').on(table.courseId),
  index('assignment_submissions_deleted_at_idx').on(table.deletedAt),
]);

export const assignmentSubmissionsRelations = relations(assignmentSubmissions, ({ one }) => ({
  student: one(students, {
    fields: [assignmentSubmissions.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [assignmentSubmissions.courseId],
    references: [courses.id],
  }),
}));

export type AssignmentSubmission = typeof assignmentSubmissions.$inferSelect;
export type NewAssignmentSubmission = typeof assignmentSubmissions.$inferInsert;
