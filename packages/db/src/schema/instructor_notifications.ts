/**
 * instructor_notifications — 수강생이 강사를 호출할 때 생성되는 알림
 *
 * 흐름:
 *  1. 수강생이 채팅 메뉴 → '강사와 채팅하기' 클릭
 *  2. 서버에서 이 테이블에 알림 레코드 생성 + Socket.io로 강사에게 push
 *  3. 강사 헤더의 알림 종 아이콘에 카운트 표시
 *  4. 강사가 클릭하여 수락하면 readAt이 채워지고 1:1 채팅 세션으로 이동
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
import { adminUsers } from './admin_users.js';
import { students } from './students.js';
import { courses } from './courses.js';

export const instructorNotifications = pgTable('instructor_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  instructorId: uuid('instructor_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  /** 알림 유형: call = 강사 호출, message = 직접 메시지 도착 등 확장 가능 */
  type: text('type').notNull().default('call'),
  /** UI에 표시할 메시지 (예: "A학생이 채팅을 원합니다.") */
  message: text('message').notNull(),
  /** 강사가 확인한 시각 (NULL = 미확인) */
  readAt: timestamp('read_at', { withTimezone: true }),
  /** 강사가 수락하여 1:1 채팅룸에 입장했는지 여부 */
  accepted: boolean('accepted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('instructor_notifications_instructor_id_idx').on(table.instructorId),
  index('instructor_notifications_student_id_idx').on(table.studentId),
  index('instructor_notifications_course_id_idx').on(table.courseId),
  index('instructor_notifications_read_at_idx').on(table.readAt),
]);

export const instructorNotificationsRelations = relations(instructorNotifications, ({ one }) => ({
  instructor: one(adminUsers, {
    fields: [instructorNotifications.instructorId],
    references: [adminUsers.id],
  }),
  student: one(students, {
    fields: [instructorNotifications.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [instructorNotifications.courseId],
    references: [courses.id],
  }),
}));

export type InstructorNotification = typeof instructorNotifications.$inferSelect;
export type NewInstructorNotification = typeof instructorNotifications.$inferInsert;
