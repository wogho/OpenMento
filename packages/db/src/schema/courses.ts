import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { students } from './students.js';
import { adminUsers } from './admin_users.js';

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  instructorId: uuid('instructor_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  subject: text('subject').notNull(), // 'java', 'python', 'react' 등
  startDate: date('start_date'),
  endDate: date('end_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 수료 과정 이력 보존
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — 기관별 과정 조회 최적화
  index('courses_institution_id_idx').on(table.institutionId),
  index('courses_deleted_at_idx').on(table.deletedAt),
]);

export const coursesRelations = relations(courses, ({ one, many }) => ({
  institution: one(institutions, {
    fields: [courses.institutionId],
    references: [institutions.id],
  }),
  students: many(students),
  instructor: one(adminUsers, {
    fields: [courses.instructorId],
    references: [adminUsers.id],
  }),
}));

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
