/**
 * persona_templates — 고객 페르소나 템플릿 DB 영속화
 *
 * Phase 4-1 개선①: persona-prompts.ts의 하드코딩된 배열을 DB로 이전.
 * 원장/강사가 GUI에서 새 산업군 페르소나를 추가·수정·삭제할 수 있습니다.
 * institutionId: null → 전역(플랫폼 기본 제공) 템플릿
 * institutionId: 기관 UUID → 해당 기관 전용 커스텀 페르소나
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';

export const personaTemplates = pgTable('persona_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** null이면 플랫폼 전역 기본 페르소나 */
  institutionId: uuid('institution_id')
    .references(() => institutions.id, { onDelete: 'cascade' }),
  /** 레거시 문자열 key (persona-prompts.ts 하위 호환, 예: 'fintech-startup-cto') */
  legacyKey: text('legacy_key'),
  industry: text('industry').notNull(),
  role: text('role').notNull(),
  /** LLM System Prompt 마크다운 전문 */
  prompt: text('prompt').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('persona_templates_institution_id_idx').on(table.institutionId),
  index('persona_templates_legacy_key_idx').on(table.legacyKey),
  index('persona_templates_deleted_at_idx').on(table.deletedAt),
]);

export const personaTemplatesRelations = relations(personaTemplates, ({ one }) => ({
  institution: one(institutions, {
    fields: [personaTemplates.institutionId],
    references: [institutions.id],
  }),
}));

export type PersonaTemplate = typeof personaTemplates.$inferSelect;
export type NewPersonaTemplate = typeof personaTemplates.$inferInsert;
