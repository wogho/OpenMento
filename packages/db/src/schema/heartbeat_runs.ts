import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents } from './agents.js';
import { institutions } from './institutions.js';

export const heartbeatStatusEnum = pgEnum('heartbeat_status', [
  'queued',
  'wakeup',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

export const heartbeatRuns = pgTable('heartbeat_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ── 멀티 테넌트 키 추가 ──
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  // paperclip: timer | on_demand | wakeup | automation
  invocationSource: text('invocation_source').notNull().default('timer'),
  triggerDetail: text('trigger_detail'),
  status: heartbeatStatusEnum('status').notNull().default('queued'),
  // 실행 잠금 (중복 실행 방지)
  executionLockedAt: timestamp('execution_locked_at', { withTimezone: true }),
  // 재시도 관련
  retryOfRunId: uuid('retry_of_run_id'),
  processLossRetryCount: integer('process_loss_retry_count').notNull().default(0),
  // 결과 저장
  usageJson: jsonb('usage_json'),        // 토큰 사용량
  stdoutExcerpt: text('stdout_excerpt'), // 로그 발췌
  resultJson: jsonb('result_json'),      // 실행 결과
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  // paperclip: 실행 시점 에이전트/예산/태스크 스냅샷
  contextSnapshot: jsonb('context_snapshot'),
  // paperclip: Session Codec — 실행 전/후 세션 식별자 감사 추적
  sessionIdBefore: text('session_id_before'),
  sessionIdAfter: text('session_id_after'),
  // paperclip: 어댑터가 반환한 오류 코드 (예: 'rate_limited', 'context_too_long')
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기관별·에이전트별 실행 이력 조회 최적화
  index('heartbeat_runs_institution_id_idx').on(table.institutionId),
  index('heartbeat_runs_agent_id_idx').on(table.agentId),
  // 대시보드 최근 실행 조회 인덱스
  index('heartbeat_runs_created_at_idx').on(table.createdAt),
  // ── 복합 인덱스 (Phase 5-2 ① 개선): RLS + 추가 필터 플래너 최적화
  // 기관별 최신 실행 이력: WHERE institution_id = X ORDER BY created_at DESC
  index('heartbeat_runs_institution_created_idx').on(table.institutionId, table.createdAt),
  // 기관별 상태 필터: WHERE institution_id = X AND status = 'running'
  index('heartbeat_runs_institution_status_idx').on(table.institutionId, table.status),
]);

export const heartbeatRunsRelations = relations(heartbeatRuns, ({ one }) => ({
  institution: one(institutions, {
    fields: [heartbeatRuns.institutionId],
    references: [institutions.id],
  }),
  agent: one(agents, {
    fields: [heartbeatRuns.agentId],
    references: [agents.id],
  }),
  retryOf: one(heartbeatRuns, {
    fields: [heartbeatRuns.retryOfRunId],
    references: [heartbeatRuns.id],
    relationName: 'retry',
  }),
}));

export type HeartbeatRun = typeof heartbeatRuns.$inferSelect;
export type NewHeartbeatRun = typeof heartbeatRuns.$inferInsert;
