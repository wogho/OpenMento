/**
 * instructor_chat_messages — 강사-수강생 1:1 채팅 메시지
 *
 * AI 채팅(conversation_messages)과는 완전히 분리된 테이블입니다.
 * 개인정보 보호 설계:
 *  - 수강생이 AI와 나눈 conversation_messages는 강사가 열람 불가
 *  - 강사가 알림을 수락하여 joinedAt을 기록한 이후부터 발생한
 *    메시지만 이 테이블에 저장됩니다.
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
import { adminUsers } from './admin_users.js';
import { students } from './students.js';
import { courses } from './courses.js';
import { instructorNotifications } from './instructor_notifications.js';

export const chatSenderRoleEnum = pgEnum('chat_sender_role', ['instructor', 'student']);

export const instructorChatMessages = pgTable('instructor_chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 강사 호출 알림과 세션을 연결 */
  notificationId: uuid('notification_id')
    .notNull()
    .references(() => instructorNotifications.id, { onDelete: 'cascade' }),
  instructorId: uuid('instructor_id')
    .notNull()
    .references(() => adminUsers.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  senderRole: chatSenderRoleEnum('sender_role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('instructor_chat_messages_notification_id_idx').on(table.notificationId),
  index('instructor_chat_messages_instructor_id_idx').on(table.instructorId),
  index('instructor_chat_messages_student_id_idx').on(table.studentId),
]);

export const instructorChatMessagesRelations = relations(instructorChatMessages, ({ one }) => ({
  notification: one(instructorNotifications, {
    fields: [instructorChatMessages.notificationId],
    references: [instructorNotifications.id],
  }),
  instructor: one(adminUsers, {
    fields: [instructorChatMessages.instructorId],
    references: [adminUsers.id],
  }),
  student: one(students, {
    fields: [instructorChatMessages.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [instructorChatMessages.courseId],
    references: [courses.id],
  }),
}));

export type InstructorChatMessage = typeof instructorChatMessages.$inferSelect;
export type NewInstructorChatMessage = typeof instructorChatMessages.$inferInsert;
