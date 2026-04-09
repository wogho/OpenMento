-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-2 개선①: RLS 복합 인덱스(Composite Index) 추가
-- ─────────────────────────────────────────────────────────────────────────────
-- 동기:
--   RLS 정책은 모든 SELECT/UPDATE/DELETE 쿼리에 `WHERE institution_id = X`
--   조건을 자동으로 추가합니다. 단순 FK 인덱스(단일 컬럼)만 있을 경우
--   RLS + 추가 필터(status, created_at DESC, action 등)가 함께 사용될 때
--   PostgreSQL 플래너가 복합 인덱스를 선택하지 못해 Table Full Scan이
--   발생할 수 있습니다.
--
-- CONCURRENTLY:
--   운영 중 테이블 Lock 없이 인덱스를 생성합니다.
--   단, 트랜잭션 내에서 실행할 수 없으므로 DDL 단독 실행이 필요합니다.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. ews_risk_scores: institution_id 컬럼 추가 ──────────────────────────────
-- 배경: ews_risk_scores 는 students FK를 통해 간접적으로 institution_id를
--      참조하지만, 0009 RLS 마이그레이션이 이 컬럼을 직접 사용합니다.
--      스키마와 RLS 정책을 일치시켜 서브쿼리 없는 직접 비교로 성능을 향상합니다.

ALTER TABLE ews_risk_scores
  ADD COLUMN IF NOT EXISTS institution_id uuid
  REFERENCES institutions(id) ON DELETE CASCADE;

-- 기존 데이터 백필: students 테이블에서 institution_id를 가져와 채움
UPDATE ews_risk_scores
SET institution_id = s.institution_id
FROM students s
WHERE s.id = ews_risk_scores.student_id
  AND ews_risk_scores.institution_id IS NULL;

-- RLS 정책 재생성: 직접 컬럼 비교 (서브쿼리 제거)
DROP POLICY IF EXISTS tenant_isolation ON ews_risk_scores;
CREATE POLICY tenant_isolation ON ews_risk_scores
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );


-- ── 2. heartbeat_runs 복합 인덱스 ─────────────────────────────────────────────
-- 대시보드: "기관별 최신 실행 이력" (institution_id + created_at DESC)
-- 모니터링: "기관별 실행 중/대기 중" (institution_id + status)

CREATE INDEX CONCURRENTLY IF NOT EXISTS heartbeat_runs_institution_created_idx
  ON heartbeat_runs (institution_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS heartbeat_runs_institution_status_idx
  ON heartbeat_runs (institution_id, status);

-- Partial Index: 아직 완료되지 않은 실행(active job) 빠른 조회
CREATE INDEX CONCURRENTLY IF NOT EXISTS heartbeat_runs_institution_active_idx
  ON heartbeat_runs (institution_id, created_at DESC)
  WHERE status IN ('queued', 'wakeup', 'running');


-- ── 3. audit_logs 복합 인덱스 ─────────────────────────────────────────────────
-- 보안감사: "기관별 최근 감사 로그" (institution_id + created_at DESC)
-- 필터링:  "기관별 액션 유형별 조회" (institution_id + action)
-- 추적:    "기관+행위자 접근 이력" (institution_id + actor_id)

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_institution_created_idx
  ON audit_logs (institution_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_institution_action_idx
  ON audit_logs (institution_id, action);

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_institution_actor_idx
  ON audit_logs (institution_id, actor_id);


-- ── 4. ews_risk_scores 복합 인덱스 ───────────────────────────────────────────
-- EWS 대시보드: "기관별 고위험 수강생" (institution_id + total_score DESC)
-- 이력 조회:   "수강생별 최신 점수" (student_id + calculated_at DESC)

CREATE INDEX CONCURRENTLY IF NOT EXISTS ews_risk_scores_institution_id_idx
  ON ews_risk_scores (institution_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ews_risk_scores_institution_score_idx
  ON ews_risk_scores (institution_id, total_score DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ews_risk_scores_student_calculated_idx
  ON ews_risk_scores (student_id, calculated_at DESC);


-- ── 5. students 추가 복합 인덱스 ──────────────────────────────────────────────
-- 등록 순 목록:  "기관별 수강생 목록 최신 등록순" (institution_id + enrolled_at DESC)
-- 과목 필터:    "기관 + 과목 수강생" (institution_id + course_id) — 소프트 딜리트 제외

CREATE INDEX CONCURRENTLY IF NOT EXISTS students_institution_enrolled_idx
  ON students (institution_id, enrolled_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS students_institution_course_idx
  ON students (institution_id, course_id)
  WHERE deleted_at IS NULL;
