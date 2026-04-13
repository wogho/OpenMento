/**
 * onboarding_completions — 온보딩 투어 완료 이력 테이블
 *
 * Phase 5-3: 신규 교육기관 사용자(원장/강사/수강생)가 역할별 투어를 완료한
 * 기록을 저장합니다. 완료 후에는 투어가 재표시되지 않습니다.
 *
 * tourId 목록:
 *   'admin-tour'   — 관리자/강사 3단계 투어
 *   'student-tour' — 수강생 3단계 투어
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { institutions } from './institutions.js';

export const onboardingCompletions = pgTable(
  'onboarding_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** JWT sub (userId) — 인증된 사용자 식별자 */
    userId: text('user_id').notNull(),
    /** 소속 교육기관 */
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    /** 완료한 투어 ID (예: 'admin-tour', 'student-tour', 'portfolio-tour', 'ews-tour') */
    tourId: text('tour_id').notNull(),
    /**
     * 마지막으로 진행한 스텝 인덱스 (0-based).
     * -1 = 아직 시작 안 함, 0+ = 진행 중 / 완료
     * Gemini 제언 [개선①]: 투어 중간 이탈 시 재접속 후 이어서 시작 가능
     */
    lastStepIndex: integer('last_step_index').notNull().default(-1),
    /**
     * 투어를 완전히 완료한 시각. null이면 진행 중(in-progress).
     * Gemini 제언 [개선①]: completedAt이 null이면 lastStepIndex 기준으로 재개.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    // 사용자당 투어별 1회만 기록 (중복 방지)
    unique('onboarding_completions_user_tour_unique').on(table.userId, table.tourId),
  ],
);

export const onboardingCompletionsRelations = relations(onboardingCompletions, ({ one }) => ({
  institution: one(institutions, {
    fields: [onboardingCompletions.institutionId],
    references: [institutions.id],
  }),
}));

export type OnboardingCompletion = typeof onboardingCompletions.$inferSelect;
export type NewOnboardingCompletion = typeof onboardingCompletions.$inferInsert;
