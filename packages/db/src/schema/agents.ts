import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { adminUsers } from './admin_users.js';

export const agentRoleEnum = pgEnum('agent_role', [
  'orchestrator',
  'ews_monitor',
  'ai_instructor',
  'ai_tutor',
  'mental_care',
  'portfolio_reviewer',
  'data_retention',
]);

/**
 * paperclip agent status 머신 (5단계)
 *  idle       → 실행 대기 중
 *  running    → heartbeat 실행 중
 *  paused     → 예산 초과 또는 관리자 일시 정지
 *  error      → 마지막 heartbeat 실패 (수동 개입 필요)
 *  terminated → 영구 비활성화 (되돌릴 수 없음)
 */
export const agentStatusEnum = pgEnum('agent_status', [
  'idle',
  'running',
  'paused',
  'error',
  'terminated',
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
  // paperclip: title — 표시용 직함 (예: "AI 튜터 · Java반")
  title: text('title'),
  // paperclip: icon — UI 표시 아이콘 식별자
  icon: text('icon'),
  // paperclip: capabilities — 다른 에이전트가 위임 대상 탐색 시 사용하는 자연어 능력 설명
  capabilities: text('capabilities'),
  // 에이전트 태그 (강사 과목, 담당 교재 등과 연동)
  tags: jsonb('tags').$type<string[]>(),
  // paperclip: status 머신 — idle/running/paused/error/terminated
  status: agentStatusEnum('status').notNull().default('idle'),
  // 계층 구조 (오케스트레이터 → 하위 에이전트)
  reportsTo: uuid('reports_to'),
  // 담당 강사 FK (조직도에서 루트 집합 분류 기준)
  instructorId: uuid('instructor_id').references(() => adminUsers.id, { onDelete: 'set null' }),
  // LLM 어댑터 설정 { provider: 'openai', model: 'gpt-4o', ... }
  adapterConfig: jsonb('adapter_config').notNull(),
  fallbackAdapterConfig: jsonb('fallback_adapter_config'),
  // paperclip: runtimeConfig — heartbeat schedule, maxConcurrentRuns 등
  runtimeConfig: jsonb('runtime_config').$type<{
    heartbeat?: { enabled: boolean; intervalSec: number; maxConcurrentRuns?: number };
  }>().notNull().default({}),
  // paperclip: permissions — 자율 실행 권한 (에이전트별 세밀 제어)
  permissions: jsonb('permissions').$type<{
    canHireDirect?: boolean;
    canAssignTasks?: boolean;
    canAccessSecrets?: boolean;
  }>().notNull().default({}),
  // paperclip: 월별 예산 추적 (cents 단위, $0.01 = 1 cent)
  budgetMonthlyCents: integer('budget_monthly_cents').notNull().default(0),
  spentMonthlyCents: integer('spent_monthly_cents').notNull().default(0),
  // paperclip: lastHeartbeatAt — 마지막 heartbeat 완료 시각
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  // 예산 초과로 자동 비활성화된 시각 (NULL = 수동 비활성 또는 활성 상태)
  budgetPausedAt: timestamp('budget_paused_at', { withTimezone: true }),
  pauseReason: text('pause_reason'),
  // paperclip: Session Codec — 마지막으로 직렬화된 세션 컨텍스트 (어댑터가 재개 시 사용)
  lastSessionParamsJson: jsonb('last_session_params_json').$type<Record<string, unknown>>(),
  // paperclip: 세션 식별자 (어댑터가 getDisplayId로 파생, 예: 원격 thread_id)
  lastSessionDisplayId: text('last_session_display_id'),
  // System Prompt 기본값 (스킬 파일로 동적 오버라이드)
  systemPrompt: text('system_prompt'),
  // RAG 활성화 여부 — false면 교재 벡터 검색 없이 LLM만 호출 (기본값: true)
  ragEnabled: boolean('rag_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 에이전트 설정 이력 보존
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — 기관별 에이전트 조회 최적화
  index('agents_institution_id_idx').on(table.institutionId),
  // 강사별 에이전트 조회 최적화
  index('agents_instructor_id_idx').on(table.instructorId),
  // 계층 자기참조 FK 인덱스 — 오케스트레이터 하위 에이전트 조회 최적화
  index('agents_reports_to_idx').on(table.reportsTo),
  index('agents_deleted_at_idx').on(table.deletedAt),
]);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  institution: one(institutions, {
    fields: [agents.institutionId],
    references: [institutions.id],
  }),
  instructor: one(adminUsers, {
    fields: [agents.instructorId],
    references: [adminUsers.id],
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
