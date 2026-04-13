/**
 * institution_settings — 기관별 범용 설정 영속화 테이블
 *
 * Phase 5 진입 전 개선:
 *   - portfolio-settings-store.ts (유사도 기준·피드백 스타일 등)
 *   - admin.ts의 secretsStore (OpenAI·Anthropic API 키, Slack Webhook URL)
 *   를 서버 메모리에서 DB로 이전합니다.
 *
 * 구조:
 *   (institutionId, settingKey) — UNIQUE 복합키
 *   settingValue               — JSONB (어떤 형태의 값도 저장 가능)
 *
 * 알려진 settingKey 목록:
 *   'portfolio'   — PortfolioSettings JSON (criticalThreshold 등)
 *   'secrets'     — { openaiApiKey?, anthropicApiKey?, openclawApiKey?, slackWebhookUrl? }
 *
 * ⚠️  Phase 5-5 보안 감사 항목:
 *   secrets 값은 현재 plaintext로 저장됩니다.
 *   PostgreSQL 컬럼 레벨 암호화(pgcrypto) 또는 외부 KMS 연동은 Phase 5-5에서 적용합니다.
 */

import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { institutions } from './institutions.js';

export const institutionSettings = pgTable(
  'institution_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    settingKey: text('setting_key').notNull(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settingValue: jsonb('setting_value').$type<Record<string, any>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique().on(t.institutionId, t.settingKey),
  }),
);

export type InstitutionSetting = typeof institutionSettings.$inferSelect;
export type NewInstitutionSetting = typeof institutionSettings.$inferInsert;
