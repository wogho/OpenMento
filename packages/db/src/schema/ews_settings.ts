/**
 * ews_settings — EWS 위험 임계치 기관별 영속 설정 테이블
 *
 * Phase 2에서 인메모리 Map으로 운영하던 임계치를 DB에 영속화합니다.
 * 기관(institution)당 1행(unique constraint)으로 관리합니다.
 * 서버 재시작 / 컨테이너 리빌드 후에도 마지막으로 저장된 임계치가 복원됩니다.
 */

import {
  pgTable,
  uuid,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';

export const ewsSettings = pgTable(
  'ews_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    /** warning 임계치 (기본 60) */
    warningThreshold: integer('warning_threshold').notNull().default(60),
    /** high_risk 임계치 (기본 75) */
    highRiskThreshold: integer('high_risk_threshold').notNull().default(75),
    /** critical 임계치 (기본 90) */
    criticalThreshold: integer('critical_threshold').notNull().default(90),
    /** Slack 에스컬레이션 트리거 점수 (기본 75) */
    slackEscalateScore: integer('slack_escalate_score').notNull().default(75),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 기관당 1행 보장
    unique('ews_settings_institution_id_unique').on(table.institutionId),
  ],
);

export const ewsSettingsRelations = relations(ewsSettings, ({ one }) => ({
  institution: one(institutions, {
    fields: [ewsSettings.institutionId],
    references: [institutions.id],
  }),
}));

export type EwsSettings = typeof ewsSettings.$inferSelect;
export type NewEwsSettings = typeof ewsSettings.$inferInsert;
