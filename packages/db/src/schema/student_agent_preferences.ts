import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { students } from './students.js';
import { courses } from './courses.js';
import { agents } from './agents.js';

/**
 * student_agent_preferences
 *
 * 수강생이 과목별로 에이전트 활성/비활성을 제어하는 개인 설정 테이블입니다.
 * - instructor_skills 의 글로벌 활성화와 별도로 학생 개별 선호를 저장합니다.
 * - 같은 (student, course, agent) 조합은 1건만 유지합니다.
 */
export const studentAgentPreferences = pgTable('student_agent_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  // 수강생 개별 Heartbeat 비활성화 (기본값: true = 비활성화)
  heartbeatDisabled: boolean('heartbeat_disabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('student_agent_pref_student_id_idx').on(table.studentId),
  index('student_agent_pref_course_id_idx').on(table.courseId),
  index('student_agent_pref_agent_id_idx').on(table.agentId),
  uniqueIndex('student_agent_pref_unique_idx').on(table.studentId, table.courseId, table.agentId),
]);

export const studentAgentPreferencesRelations = relations(studentAgentPreferences, ({ one }) => ({
  student: one(students, {
    fields: [studentAgentPreferences.studentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [studentAgentPreferences.courseId],
    references: [courses.id],
  }),
  agent: one(agents, {
    fields: [studentAgentPreferences.agentId],
    references: [agents.id],
  }),
}));

export type StudentAgentPreference = typeof studentAgentPreferences.$inferSelect;
export type NewStudentAgentPreference = typeof studentAgentPreferences.$inferInsert;
