/**
 * agent_messages.ts — 에이전트 자율 발화 및 에이전트 간 교신 메시지
 *
 * paperclip Task Comments 구조 차용:
 *   POST /api/issues/:issueId/comments { body, authorAgentId }
 *
 * 용도:
 *   - 'heartbeat'   : 에이전트가 수강생에게 선제적으로 발화 (자율 메시지)
 *   - 'agent_reply' : 다른 에이전트의 heartbeat 발화에 대해 응답
 *   - 'task_comment': 에이전트 간 작업 공유/협업 메모 (audit trail)
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents } from './agents.js';
import { students } from './students.js';
import { courses } from './courses.js';
import { institutions } from './institutions.js';

export const agentMessageTypeEnum = pgEnum('agent_message_type', [
  'heartbeat',    // 에이전트 → 수강생 (자율 발화)
  'agent_reply',  // 에이전트 → 에이전트 (교신 응답)
  'task_comment', // 에이전트 → 에이전트 (작업 공유, audit trail)
]);

export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 멀티 테넌트 키
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  // 발화 에이전트
  authorAgentId: uuid('author_agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  // 응답 대상 에이전트 (NULL = 수강생 대상 발화)
  targetAgentId: uuid('target_agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  // 수신 수강생 (NULL = 에이전트 간 내부 교신)
  targetStudentId: uuid('target_student_id')
    .references(() => students.id, { onDelete: 'set null' }),
  // 과목 컨텍스트
  courseId: uuid('course_id')
    .references(() => courses.id, { onDelete: 'set null' }),
  // 메시지 본문 (마크다운 지원)
  body: text('body').notNull(),
  // 메시지 유형
  messageType: agentMessageTypeEnum('message_type').notNull().default('heartbeat'),
  // 연속 교신 턴 번호 (무한루프 방지용 — 동일 세션 내 educator chain 추적)
  turnIndex: integer('turn_index').notNull().default(0),
  // 이 메시지를 트리거한 원본 heartbeat message id (교신 체인 추적)
  triggerMessageId: uuid('trigger_message_id'),
  // Socket.IO로 수강생에게 전달됐는지 여부
  delivered: text('delivered').notNull().default('pending'), // 'pending' | 'sent' | 'failed'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('agent_messages_institution_idx').on(table.institutionId),
  index('agent_messages_author_idx').on(table.authorAgentId),
  index('agent_messages_student_idx').on(table.targetStudentId),
  index('agent_messages_course_idx').on(table.courseId),
  index('agent_messages_created_idx').on(table.createdAt),
]);

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  institution: one(institutions, {
    fields: [agentMessages.institutionId],
    references: [institutions.id],
  }),
  authorAgent: one(agents, {
    fields: [agentMessages.authorAgentId],
    references: [agents.id],
    relationName: 'authored_messages',
  }),
  targetAgent: one(agents, {
    fields: [agentMessages.targetAgentId],
    references: [agents.id],
    relationName: 'received_messages',
  }),
  targetStudent: one(students, {
    fields: [agentMessages.targetStudentId],
    references: [students.id],
  }),
  course: one(courses, {
    fields: [agentMessages.courseId],
    references: [courses.id],
  }),
}));

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
