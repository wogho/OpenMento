import {
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { portfolioProjects } from './portfolio_projects.js';

export const portfolioSimilarityLogs = pgTable('portfolio_similarity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 비교 대상 기획서
  sourceProjectId: uuid('source_project_id')
    .notNull()
    .references(() => portfolioProjects.id, { onDelete: 'cascade' }),
  // 비교된 수료생 기획서 (NULL이면 외부 레퍼런스)
  compareProjectId: uuid('compare_project_id')
    .references(() => portfolioProjects.id, { onDelete: 'set null' }),
  similarityScore: real('similarity_score').notNull(),
  // 'differentiation_required' | 'improvement_recommended' | 'originality_confirmed'
  verdict: text('verdict').notNull(),
  feedbackText: text('feedback_text'),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // FK 인덱스 — 기획서별 유사도 이력 조회 최적화
  index('portfolio_similarity_logs_source_project_id_idx').on(table.sourceProjectId),
  index('portfolio_similarity_logs_compare_project_id_idx').on(table.compareProjectId),
]);

export const portfolioSimilarityLogsRelations = relations(portfolioSimilarityLogs, ({ one }) => ({
  sourceProject: one(portfolioProjects, {
    fields: [portfolioSimilarityLogs.sourceProjectId],
    references: [portfolioProjects.id],
    relationName: 'source',
  }),
  compareProject: one(portfolioProjects, {
    fields: [portfolioSimilarityLogs.compareProjectId],
    references: [portfolioProjects.id],
    relationName: 'compare',
  }),
}));

export type PortfolioSimilarityLog = typeof portfolioSimilarityLogs.$inferSelect;
export type NewPortfolioSimilarityLog = typeof portfolioSimilarityLogs.$inferInsert;
