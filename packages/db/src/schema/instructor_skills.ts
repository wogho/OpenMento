import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';
import { agents } from './agents.js';
import { courses } from './courses.js';

// paperclip company_skills → instructor_skills 리네임
// companyId → institutionId 변경
export const instructorSkills = pgTable('instructor_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id')
    .notNull()
    .references(() => institutions.id, { onDelete: 'cascade' }),
  // 적용 과목 (Java반 전용 스킬 등)
  courseId: uuid('course_id')
    .references(() => courses.id, { onDelete: 'set null' }),
  // 적용 에이전트
  agentId: uuid('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  // System Prompt에 주입되는 마크다운 컨텐츠
  markdown: text('markdown').notNull(),
  // 스킬 생태계 확장을 위한 태그 및 교재 연동 (Phase 7-C)
  tags: jsonb('tags').$type<string[]>(), 
  isActive: boolean('is_active').notNull().default(true),
  // GitHub 임포트 추적 (sourceRef = git commit hash)
  sourceRef: text('source_ref'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Soft Delete — 스킬 파일 버전 이력 보존 (sourceRef 추적 연계)
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  // FK 인덱스 — 에이전트에 주입할 스킬 조회 최적화
  index('instructor_skills_institution_id_idx').on(table.institutionId),
  index('instructor_skills_course_id_idx').on(table.courseId),
  index('instructor_skills_agent_id_idx').on(table.agentId),
  index('instructor_skills_deleted_at_idx').on(table.deletedAt),
]);

export const instructorSkillsRelations = relations(instructorSkills, ({ one }) => ({
  institution: one(institutions, {
    fields: [instructorSkills.institutionId],
    references: [institutions.id],
  }),
  course: one(courses, {
    fields: [instructorSkills.courseId],
    references: [courses.id],
  }),
  agent: one(agents, {
    fields: [instructorSkills.agentId],
    references: [agents.id],
  }),
}));

export type InstructorSkill = typeof instructorSkills.$inferSelect;
export type NewInstructorSkill = typeof instructorSkills.$inferInsert;
