/**
 * student_courses — 수강생-과목 N:M 연결 테이블
 *
 * 수강생은 여러 과목을 수강할 수 있고,
 * 과목에는 여러 수강생이 등록될 수 있습니다.
 */
import { pgTable, uuid, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { students } from './students.js';
import { courses } from './courses.js';

export const studentCourses = pgTable('student_courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft delete
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('student_courses_student_course_uidx').on(table.studentId, table.courseId),
  index('student_courses_student_id_idx').on(table.studentId),
  index('student_courses_course_id_idx').on(table.courseId),
]);

export const studentCoursesRelations = relations(studentCourses, ({ one }) => ({
  student: one(students, {
    fields: [studentCourses.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [studentCourses.courseId],
    references: [courses.id],
  }),
}));
