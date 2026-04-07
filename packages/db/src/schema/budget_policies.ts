import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  real,
  boolean,
  pgEnum,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents } from './agents.js';
import { institutions } from './institutions.js';

export const budgetPeriodEnum = pgEnum('budget_period', ['monthly', 'weekly', 'daily']);

// LLM API 예산 정책
export const budgetPolicies = pgTable('budget_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .references(() => agents.id, { onDelete: 'cascade' }),
  period: budgetPeriodEnum('period').notNull().default('monthly'),
  // USD 단위 예산 상한
  limitUsd: real('limit_usd').notNull(),
  // Soft Alert 임계치 (기본 80%)
  alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
  // 초과 시 동작: 'pause' | 'alert_only'
  onExceed: text('on_exceed').notNull().default('pause'),
  isActive: text('is_active').notNull().default('true'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기관별·에이전트별 예산 조리 조회 최적화
  index('budget_policies_institution_id_idx').on(table.institutionId),
  index('budget_policies_agent_id_idx').on(table.agentId),
]);

// LLM 호출 비용 이벤트 (토큰 사용량 추적)
export const costEvents = pgTable('cost_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(), // 'openai', 'anthropic', 'google'
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 월별 비용 집계 쿼리 (Soft Alert 80% 판단) 최적화
  index('cost_events_institution_id_idx').on(table.institutionId),
  index('cost_events_agent_id_idx').on(table.agentId),
  // 월별 집계를 위한 시간 인덱스
  index('cost_events_created_at_idx').on(table.createdAt),
]);

export const budgetPoliciesRelations = relations(budgetPolicies, ({ one }) => ({
  institution: one(institutions, {
    fields: [budgetPolicies.institutionId],
    references: [institutions.id],
  }),
  agent: one(agents, {
    fields: [budgetPolicies.agentId],
    references: [agents.id],
  }),
}));

export const costEventsRelations = relations(costEvents, ({ one }) => ({
  institution: one(institutions, {
    fields: [costEvents.institutionId],
    references: [institutions.id],
  }),
  agent: one(agents, {
    fields: [costEvents.agentId],
    references: [agents.id],
  }),
}));

export type BudgetPolicy = typeof budgetPolicies.$inferSelect;
export type NewBudgetPolicy = typeof budgetPolicies.$inferInsert;
export type CostEvent = typeof costEvents.$inferSelect;
export type NewCostEvent = typeof costEvents.$inferInsert;

// ── 모델 단가 테이블 (Phase 2-7 개선④: DB 기반 요금표 관리) ──────────────────
// GUI에서 요금표를 수정할 수 있어 재배포 없이 단가를 갱신합니다.
// 미등록 모델은 budget-guard.ts에 내장된 DEFAULT_PRICING을 폴백으로 사용합니다.
export const modelPricing = pgTable('model_pricing', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // 'openai' | 'anthropic'
  model: text('model').notNull(),       // 'gpt-4o', 'claude-3-5-sonnet-20241022' 등
  // USD per 1,000 tokens
  inputPer1k: real('input_per_1k').notNull(),
  outputPer1k: real('output_per_1k').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('model_pricing_provider_model_uidx').on(table.provider, table.model),
]);

export type ModelPricing = typeof modelPricing.$inferSelect;
export type NewModelPricing = typeof modelPricing.$inferInsert;
