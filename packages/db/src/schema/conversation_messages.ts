import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { students } from './students.js';
import { agents } from './agents.js';
import { courses } from './courses.js';

// ── 메시지 발신자 역할 ─────────────────────────────────────────────────────
export const messageRoleEnum = pgEnum('message_role', [
  'user',       // 수강생 발신
  'assistant',  // AI 에이전트 응답
  'system',     // 시스템 메시지 (주입용, DB 저장만 하고 UI에는 노출 안 함)
]);

// ── conversation_messages 테이블 ──────────────────────────────────────────
// Multi-turn 대화 이력 — AI 튜터 응답의 컨텍스트 연속성을 위해 저장합니다.
// 하나의 '세션(sessionId)'이 연속된 메시지 묶음을 표현합니다.
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // ── 세션 ────────────────────────────────────────────────────────────
    // 수강생 + 에이전트 + 시작 시각 조합으로 자동 생성되는 UUID
    // 한 번의 대화 흐름(Q&A 연속)을 묶는 논리적 그룹 식별자
    sessionId: uuid('session_id').notNull(),
    // ── 발신자 정보 ──────────────────────────────────────────────────────
    role: messageRoleEnum('role').notNull(),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    // ── 내용 ────────────────────────────────────────────────────────────
    content: text('content').notNull(),
    // RAG 검색 결과 참조 (소크라테스 답변에서 인용한 출처) — 옵셔널
    ragSourcesJson: jsonb('rag_sources_json'),
    // 응답 생성에 사용된 LLM 메타데이터 (모델명, 토큰 수 등) — 비용 추적용
    llmMetaJson: jsonb('llm_meta_json'),
    // 순서 번호 — 세션 내 메시지 재정렬용 (client clock skew 대응)
    turnIndex: integer('turn_index').notNull().default(0),
    // ── 기관 컨텍스트 ─────────────────────────────────────────────────────
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    // ── 멘탈케어 읽음 확인 (어드민/강사 전용) ─────────────────────────────
    // mental-care-agent 가 생성한 메시지를 어드민이 확인했는지 추적합니다.
    // PATCH /admin/messages/:id/read 로 true 로 전환합니다.
    isAdminRead: boolean('is_admin_read').notNull().default(false),
    // ── 타임스탬프 ──────────────────────────────────────────────────────
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // sessionId 기반 대화 이력 조회 최적화
    index('conv_messages_session_idx').on(table.sessionId),
    // 수강생별 전체 이력 조회
    index('conv_messages_student_idx').on(table.studentId),
    // 에이전트별 응답 이력 (비용 집계 등)
    index('conv_messages_agent_idx').on(table.agentId),
    // 세션 내 순서 정렬
    index('conv_messages_session_turn_idx').on(table.sessionId, table.turnIndex),
    // 어드민 미읽음 멘탈케어 메시지 빠른 조회 (Partial Index)
    index('conv_messages_unread_idx')
      .on(table.createdAt)
      .where(sql`${table.isAdminRead} = false`),
    // 주석: conversation_messages 는 수강생 50명 이상·장기 운영 시 급증 예상
    //   → Phase 5-A 이후 created_at 기준 월별 RANGE PARTITION 적용 결정
    //   → 'CREATE TABLE conversation_messages PARTITION BY RANGE (created_at)'
  ],
);

export const conversationMessagesRelations = relations(conversationMessages, ({ one }) => ({
  student: one(students, {
    fields: [conversationMessages.studentId],
    references: [students.id],
  }),
  agent: one(agents, {
    fields: [conversationMessages.agentId],
    references: [agents.id],
  }),
  course: one(courses, {
    fields: [conversationMessages.courseId],
    references: [courses.id],
  }),
}));

export type ConversationMessage    = typeof conversationMessages.$inferSelect;
export type NewConversationMessage = typeof conversationMessages.$inferInsert;
