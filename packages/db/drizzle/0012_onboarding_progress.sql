-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-3 개선 ①: 온보딩 진행 척도(Intermediate Progress) 트래킹
--
-- Gemini 제언 반영:
--   1. last_step_index 컬럼 추가 — 투어 중간 이탈 시 마지막 스텝 저장
--   2. completed_at 을 nullable 로 전환 — NULL = 진행 중, NOT NULL = 완료
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 투어별 마지막 완료 스텝 인덱스 (0-based, -1 = 아직 시작 안 함)
ALTER TABLE "onboarding_completions"
  ADD COLUMN IF NOT EXISTS "last_step_index" integer NOT NULL DEFAULT -1;

-- 2. completed_at 을 nullable 로 변경 (진행 중인 레코드는 NULL)
ALTER TABLE "onboarding_completions"
  ALTER COLUMN "completed_at" DROP NOT NULL,
  ALTER COLUMN "completed_at" DROP DEFAULT;

-- 3. 진행 중 레코드 조회 인덱스 (completed_at IS NULL 조건 최적화)
CREATE INDEX IF NOT EXISTS "idx_onboarding_completions_in_progress"
  ON "onboarding_completions" ("user_id")
  WHERE "completed_at" IS NULL;
