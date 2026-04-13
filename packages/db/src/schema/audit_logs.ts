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
import { institutions } from './institutions.js';

export const auditActionEnum = pgEnum('audit_action', [
  'read',
  'write',
  'delete',
  'webhook_receive',
  'mcp_connector_call',
  'agent_run',
]);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .references(() => institutions.id, { onDelete: 'set null' }),
  // 에이전트 또는 사용자 식별자
  actorId: uuid('actor_id'),
  actorType: text('actor_type').notNull(), // 'agent', 'instructor', 'admin', 'system'
  action: auditActionEnum('action').notNull(),
  // 접근 대상 리소스
  resourceType: text('resource_type'), // 'lms', 'attendance', 'github', 'openai'
  resourceId: text('resource_id'),
  // 요청/응답 요약 (민감 정보 제외)
  metadata: jsonb('metadata'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기관별 감사 로그 조회 최적화
  index('audit_logs_institution_id_idx').on(table.institutionId),
  // 행위자별 접근 이력 추적 인덱스
  index('audit_logs_actor_id_idx').on(table.actorId),
  // 시간 범위 쿼리 인덱스 (보안 감사 기간 필터링)
  index('audit_logs_created_at_idx').on(table.createdAt),
  // ── 복합 인덱스 (Phase 5-2 ① 개선): RLS + 보안감사 필터 플래너 최적화
  // 기관별 최근 감사 로그: WHERE institution_id = X ORDER BY created_at DESC
  index('audit_logs_institution_created_idx').on(table.institutionId, table.createdAt),
  // 기관+액션 필터: WHERE institution_id = X AND action = 'agent_run'
  index('audit_logs_institution_action_idx').on(table.institutionId, table.action),
  // 기관+행위자 추적: WHERE institution_id = X AND actor_id = Y
  index('audit_logs_institution_actor_idx').on(table.institutionId, table.actorId),
]);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  institution: one(institutions, {
    fields: [auditLogs.institutionId],
    references: [institutions.id],
  }),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
