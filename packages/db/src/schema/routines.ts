import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  pgEnum,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { agents } from './agents.js';
import { institutions } from './institutions.js';
import { courses } from './courses.js';

export const triggerKindEnum = pgEnum('trigger_kind', ['cron', 'webhook', 'manual']);

export const routines = pgTable('routines', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  // ── 교육 도메인 추가 컬럼 ──
  courseId: uuid('course_id')
    .references(() => courses.id, { onDelete: 'set null' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기관별·에이전트별·과목별 루틴 조회 최적화
  index('routines_institution_id_idx').on(table.institutionId),
  index('routines_agent_id_idx').on(table.agentId),
  index('routines_course_id_idx').on(table.courseId),
]);

export const routineTriggers = pgTable('routine_triggers', {
  id: uuid('id').primaryKey().defaultRandom(),
  routineId: uuid('routine_id')
    .notNull()
    .references(() => routines.id, { onDelete: 'cascade' }),
  kind: triggerKindEnum('kind').notNull(),
  // cron 표현식 (kind="cron"일 때) — 5-field 독립 파서 사용
  cronExpression: text('cron_expression'),
  // Webhook 이벤트 타입 (kind="webhook"일 때)
  webhookEvent: text('webhook_event'), // 'push', 'pull_request'
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 루틴별 트리거 조회 최적화
  index('routine_triggers_routine_id_idx').on(table.routineId),
]);

export const routinesRelations = relations(routines, ({ one, many }) => ({
  institution: one(institutions, {
    fields: [routines.institutionId],
    references: [institutions.id],
  }),
  course: one(courses, {
    fields: [routines.courseId],
    references: [courses.id],
  }),
  agent: one(agents, {
    fields: [routines.agentId],
    references: [agents.id],
  }),
  triggers: many(routineTriggers),
}));

export const routineTriggersRelations = relations(routineTriggers, ({ one }) => ({
  routine: one(routines, {
    fields: [routineTriggers.routineId],
    references: [routines.id],
  }),
}));

export type Routine = typeof routines.$inferSelect;
export type NewRoutine = typeof routines.$inferInsert;
export type RoutineTrigger = typeof routineTriggers.$inferSelect;
export type NewRoutineTrigger = typeof routineTriggers.$inferInsert;
