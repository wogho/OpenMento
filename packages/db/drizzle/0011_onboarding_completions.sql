-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-3: 온보딩 가이드 완료 이력 테이블 추가
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "onboarding_completions" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        text    NOT NULL,
  "institution_id" uuid    NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "tour_id"        text    NOT NULL,
  "completed_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "onboarding_completions_user_tour_unique" UNIQUE ("user_id", "tour_id")
);

-- institution_id 기반 조회 (RLS 정책 + index 지원)
CREATE INDEX IF NOT EXISTS "idx_onboarding_completions_institution_id"
  ON "onboarding_completions" ("institution_id");

-- user_id 기반 단건 조회 지원
CREATE INDEX IF NOT EXISTS "idx_onboarding_completions_user_id"
  ON "onboarding_completions" ("user_id");
