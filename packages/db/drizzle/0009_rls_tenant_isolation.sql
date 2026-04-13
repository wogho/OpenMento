-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5-2: Row-Level Security (RLS) — 멀티 테넌트 데이터 격리
-- ─────────────────────────────────────────────────────────────────────────────
-- 구조:
--   각 테이블에 RLS를 활성화하고, 세션 변수 app.institution_id 와
--   테이블의 institution_id 컬럼을 비교하는 정책을 추가합니다.
--
-- 세션 변수 설정 방법 (애플리케이션 코드):
--   SET LOCAL app.institution_id = '<UUID>';       -- 트랜잭션 스코프
--   SET app.institution_id = '<UUID>';             -- 세션 스코프 (폴백)
--
-- Super Admin 바이패스:
--   app.institution_id = 'super' 로 설정하면 모든 기관 데이터에 접근 가능합니다.
--   이는 애플리케이션 레이어에서 super_admin role 확인 후 부여됩니다.
--
-- ⚠️  FORCE ROW LEVEL SECURITY:
--   FORCE 옵션을 사용하면 테이블 소유자(superuser)도 정책을 따르게 됩니다.
--   현재는 FORCE 없이 적용 — 앱 유저는 non-superuser이므로 정책이 항상 적용됨.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 핵심 테이블 RLS 활성화 ─────────────────────────────────────────────────
ALTER TABLE students              ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_skills     ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_policies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ews_risk_scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ews_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_projects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeat_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs            ENABLE ROW LEVEL SECURITY;

-- 2. 테넌트 격리 정책 생성 ─────────────────────────────────────────────────
-- NULLIF 처리: 세션 변수가 설정되지 않으면 NULL → 빈 결과 반환 (안전 기본값)
-- 'super' 값: Super Admin의 전체 기관 접근 허용

CREATE POLICY tenant_isolation ON students
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON courses
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON agents
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON instructor_skills
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON budget_policies
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON rag_documents
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON ews_risk_scores
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON ews_settings
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON institution_settings
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON routines
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON goals
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON portfolio_projects
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON heartbeat_runs
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

-- persona_templates: institution_id가 NULL이면 전역 템플릿 (모든 기관 공유)
CREATE POLICY tenant_isolation ON persona_templates
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id IS NULL
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

CREATE POLICY tenant_isolation ON audit_logs
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR institution_id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );

-- 3. institutions 테이블: super_admin만 전체 조회 가능 ─────────────────────
-- 일반 admin은 자신의 기관만 조회 (app.institution_id 로 필터)
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON institutions
  USING (
    NULLIF(current_setting('app.institution_id', true), '') = 'super'
    OR id = NULLIF(current_setting('app.institution_id', true), '')::uuid
  );
