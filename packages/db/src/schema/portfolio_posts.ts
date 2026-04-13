import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { students } from './students.js';
import { courses } from './courses.js';
import { agents } from './agents.js';

export const portfolioPostStatusEnum = pgEnum('portfolio_post_status', [
  'draft',
  'submitted',
  'reviewed',
]);

export const portfolioPosts = pgTable('portfolio_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  fileUrl: text('file_url'),
  fileName: text('file_name'),
  status: portfolioPostStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('portfolio_posts_student_id_idx').on(table.studentId),
  index('portfolio_posts_course_id_idx').on(table.courseId),
  index('portfolio_posts_deleted_at_idx').on(table.deletedAt),
]);

// ── 댓글 (강사/수강생/AI) ────────────────────────────────────────────────────
export const portfolioPostCommentAuthorTypeEnum = pgEnum('portfolio_post_comment_author_type', [
  'student',
  'instructor',
  'agent',
]);

export const portfolioPostComments = pgTable('portfolio_post_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id')
    .notNull()
    .references(() => portfolioPosts.id, { onDelete: 'cascade' }),
  // authorId = studentId or adminUserId depending on authorType
  authorId: uuid('author_id').notNull(),
  authorType: portfolioPostCommentAuthorTypeEnum('author_type').notNull(),
  agentId: uuid('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  authorName: text('author_name'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('portfolio_post_comments_post_id_idx').on(table.postId),
]);

// ── Relations ─────────────────────────────────────────────────────────────────
export const portfolioPostsRelations = relations(portfolioPosts, ({ one, many }) => ({
  student: one(students, { fields: [portfolioPosts.studentId], references: [students.id] }),
  course:  one(courses,  { fields: [portfolioPosts.courseId],  references: [courses.id] }),
  comments: many(portfolioPostComments),
}));

export const portfolioPostCommentsRelations = relations(portfolioPostComments, ({ one }) => ({
  post: one(portfolioPosts, { fields: [portfolioPostComments.postId], references: [portfolioPosts.id] }),
}));
