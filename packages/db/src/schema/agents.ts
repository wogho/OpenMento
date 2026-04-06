import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';

export const agentRoleEnum = pgEnum('agent_role', [
  'orchestrator',
  'ews_monitor',
  'ai_instructor',
  'ai_tutor',
  'mental_care',
  'portfolio_reviewer',
]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ── 멀티 테넌트 키 (paperclip 차용 + institutionId 추가) ──
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  role: agentRoleEnum('role').notNull(),
  // 계층 구조 (오케스트레이터 → 하위 에이전트)
  reportsTo: uuid('reports_to'),
  // LLM 어댑터 설정 { provider: 'openai', model: 'gpt-4o', ... }
  adapterConfig: jsonb('adapter_config').notNull(),
  fallbackAdapterConfig: jsonb('fallback_adapter_config'),
  isActive: boolean('is_active').notNull().default(true),
  // System Prompt 기본값 (스킬 파일로 동적 오버라이드)
  systemPrompt: text('system_prompt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 에이전트 설정 이력 보존
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — 기관별 에이전트 조회 최적화
  index('agents_institution_id_idx').on(table.institutionId),
  // 계층 자기참조 FK 인덱스 — 오케스트레이터 하위 에이전트 조회 최적화
  index('agents_reports_to_idx').on(table.reportsTo),
  index('agents_deleted_at_idx').on(table.deletedAt),
]);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  institution: one(institutions, {
    fields: [agents.institutionId],
    references: [institutions.id],
  }),
  parent: one(agents, {
    fields: [agents.reportsTo],
    references: [agents.id],
    relationName: 'hierarchy',
  }),
  children: many(agents, { relationName: 'hierarchy' }),
}));

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
