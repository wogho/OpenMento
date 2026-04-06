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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기관별·에이전트별 실행 이력 조회 최적화
  index('heartbeat_runs_institution_id_idx').on(table.institutionId),
  index('heartbeat_runs_agent_id_idx').on(table.agentId),
  // 대시보드 최근 실행 조회 인덱스
  index('heartbeat_runs_created_at_idx').on(table.createdAt),
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
