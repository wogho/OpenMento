import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents } from './agents.js';
import { institutions } from './institutions.js';

export const goalStatusEnum = pgEnum('goal_status', [
  'pending',
  'active',
  'completed',
  'failed',
  'cancelled',
]);

// 다중 에이전트 협업 공유 목표 (Phase 4 포트폴리오 워크플로우 활용)
export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .references(() => institutions.id, { onDelete: 'set null' }),
  // 목표를 시작한 에이전트 (오케스트레이터)
  initiatorAgentId: uuid('initiator_agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  status: goalStatusEnum('status').notNull().default('pending'),
  // 에이전트 간 공유 컨텍스트 데이터
  sharedContext: jsonb('shared_context'),
  result: jsonb('result'),
  // 무한 루프 방지
  maxIterations: text('max_iterations').default('10'),
  currentIteration: text('current_iteration').default('0'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기관별·에이전트별 목표 조회 최적화 (Phase 4 포트폴리오 워크플로)
  index('goals_institution_id_idx').on(table.institutionId),
  index('goals_initiator_agent_id_idx').on(table.initiatorAgentId),
]);

export const goalsRelations = relations(goals, ({ one }) => ({
  institution: one(institutions, {
    fields: [goals.institutionId],
    references: [institutions.id],
  }),
  initiatorAgent: one(agents, {
    fields: [goals.initiatorAgentId],
    references: [agents.id],
  }),
}));

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
