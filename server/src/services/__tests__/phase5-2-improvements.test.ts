/**
 * phase5-2-improvements.test.ts
 *
 * Phase 5-2 개선 검증 테스트 (3가지 피드백 반영)
 *
 * 커버리지:
 *  ① 복합 인덱스 — DB 마이그레이션 SQL 파일 유효성 검증
 *  ① ews_risk_scores — institutionId 컬럼 추가 및 스키마 반영 검증
 *  ② ESLint 룰 — no-direct-db-in-routes 규칙 로직 단위 테스트
 *  ② TenantRepository — withTenantContext 위임 검증
 *  ③ tenant-assert — assertTenantExists / warnIfRlsEmpty / rlsErrorHandler 동작 검증
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { assertTenantExists, warnIfRlsEmpty, rlsErrorHandler, RlsNotFoundError } from '../../utils/tenant-assert.js';

// ───────────────────────── 경로 헬퍼 ──────────────────────────────────────────
const ROOT = path.resolve(__dirname, '../../../..');
const DB_DRIZZLE = path.join(ROOT, 'packages/db/drizzle');
const TOOLS_RULES = path.join(ROOT, 'tools/eslint-rules');

// ─────────────────────────────────────────────────────────────────────────────
// ① 복합 인덱스 마이그레이션 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('① 복합 인덱스 마이그레이션 (0010)', () => {
  let sql: string;

  beforeEach(() => {
    sql = readFileSync(path.join(DB_DRIZZLE, '0010_rls_composite_indexes.sql'), 'utf-8');
  });

  it('마이그레이션 파일이 존재해야 한다', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('ews_risk_scores에 institution_id 컬럼 추가 DDL이 있어야 한다', () => {
    expect(sql).toContain('ALTER TABLE ews_risk_scores');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS institution_id');
  });

  it('기존 데이터 백필 UPDATE 문이 있어야 한다', () => {
    expect(sql).toContain('UPDATE ews_risk_scores');
    expect(sql).toContain('FROM students s');
  });

  it('ews_risk_scores RLS 정책이 재생성되어야 한다', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS tenant_isolation ON ews_risk_scores');
    expect(sql).toContain('CREATE POLICY tenant_isolation ON ews_risk_scores');
  });

  it('heartbeat_runs 복합 인덱스가 포함되어야 한다', () => {
    expect(sql).toContain('heartbeat_runs_institution_created_idx');
    expect(sql).toContain('heartbeat_runs_institution_status_idx');
    expect(sql).toContain('heartbeat_runs_institution_active_idx');
  });

  it('audit_logs 복합 인덱스가 포함되어야 한다', () => {
    expect(sql).toContain('audit_logs_institution_created_idx');
    expect(sql).toContain('audit_logs_institution_action_idx');
    expect(sql).toContain('audit_logs_institution_actor_idx');
  });

  it('ews_risk_scores 복합 인덱스가 포함되어야 한다', () => {
    expect(sql).toContain('ews_risk_scores_institution_id_idx');
    expect(sql).toContain('ews_risk_scores_institution_score_idx');
    expect(sql).toContain('ews_risk_scores_student_calculated_idx');
  });

  it('students 복합 인덱스가 포함되어야 한다', () => {
    expect(sql).toContain('students_institution_enrolled_idx');
    expect(sql).toContain('students_institution_course_idx');
  });

  it('CONCURRENTLY 키워드를 사용해야 한다 (운영 중 Lock-free)', () => {
    const concurrentlyCount = (sql.match(/CONCURRENTLY/g) ?? []).length;
    // heartbeat(3) + audit_logs(3) + ews_risk_scores(3) + students(2) = 11 이상
    expect(concurrentlyCount).toBeGreaterThanOrEqual(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ① ews_risk_scores 스키마 — institutionId 컬럼
// ─────────────────────────────────────────────────────────────────────────────

describe('① ews_risk_scores 스키마 — institutionId 컬럼 추가', () => {
  it('institutionId 컬럼이 스키마에 정의되어야 한다', async () => {
    const { ewsRiskScores } = await import('@openmento/db');
    const columns = Object.keys(ewsRiskScores);
    expect(columns).toContain('institutionId');
  });

  it('복합 인덱스가 스키마에 정의되어야 한다', () => {
    const schemaSource = readFileSync(
      path.join(ROOT, 'packages/db/src/schema/ews_risk_scores.ts'),
      'utf-8',
    );
    expect(schemaSource).toContain('ews_risk_scores_institution_score_idx');
    expect(schemaSource).toContain('ews_risk_scores_student_calculated_idx');
  });

  it('heartbeat_runs 복합 인덱스가 스키마에 정의되어야 한다', () => {
    const schemaSource = readFileSync(
      path.join(ROOT, 'packages/db/src/schema/heartbeat_runs.ts'),
      'utf-8',
    );
    expect(schemaSource).toContain('heartbeat_runs_institution_created_idx');
    expect(schemaSource).toContain('heartbeat_runs_institution_status_idx');
  });

  it('audit_logs 복합 인덱스가 스키마에 정의되어야 한다', () => {
    const schemaSource = readFileSync(
      path.join(ROOT, 'packages/db/src/schema/audit_logs.ts'),
      'utf-8',
    );
    expect(schemaSource).toContain('audit_logs_institution_created_idx');
    expect(schemaSource).toContain('audit_logs_institution_action_idx');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② ESLint 커스텀 룰 — no-direct-db-in-routes
// ─────────────────────────────────────────────────────────────────────────────

describe('② ESLint 룰 — no-direct-db-in-routes', () => {
  // 룰 JS 파일 직접 로딩 (ESLint 런타임 없이 규칙 로직 확인)
  let ruleSource: string;

  beforeEach(() => {
    ruleSource = readFileSync(
      path.join(TOOLS_RULES, 'no-direct-db-in-routes.js'),
      'utf-8',
    );
  });

  it('룰 파일이 존재하고 내용이 있어야 한다', () => {
    expect(ruleSource.length).toBeGreaterThan(200);
  });

  it('ImportDeclaration 핸들러가 있어야 한다 (import 탐지)', () => {
    expect(ruleSource).toContain('ImportDeclaration');
    expect(ruleSource).toContain('@openmento/db');
  });

  it('CallExpression 핸들러가 있어야 한다 (메서드 호출 탐지)', () => {
    expect(ruleSource).toContain('CallExpression');
    expect(ruleSource).toContain('MemberExpression');
  });

  it('withTenantContext 내부 호출은 허용해야 한다', () => {
    expect(ruleSource).toContain('withTenantContext');
    expect(ruleSource).toContain('insideTenantContext');
  });

  it('routes/ 파일에서만 검사해야 한다 (isRoutesFile)', () => {
    expect(ruleSource).toContain('/routes/');
    expect(ruleSource).toContain('isRoutesFile');
  });

  it('허용 경로 목록이 정의되어야 한다 (repositories, services 등)', () => {
    expect(ruleSource).toContain('/repositories/');
    expect(ruleSource).toContain('/services/');
    expect(ruleSource).toContain('/__tests__/');
  });

  it('noDirectDbImport, noDirectDbCall 메시지 ID가 정의되어야 한다', () => {
    expect(ruleSource).toContain('noDirectDbImport');
    expect(ruleSource).toContain('noDirectDbCall');
  });

  it('index.js 플러그인 엔트리포인트가 존재해야 한다', () => {
    const indexSource = readFileSync(path.join(TOOLS_RULES, 'index.js'), 'utf-8');
    expect(indexSource).toContain('no-direct-db-in-routes');
    expect(indexSource).toContain('require(\'./no-direct-db-in-routes\')');
  });

  it('.eslintrc.json 에 local-rules 플러그인이 등록되어야 한다', () => {
    const eslintrc = readFileSync(
      path.join(ROOT, '.eslintrc.json'),
      'utf-8',
    );
    expect(eslintrc).toContain('"local-rules"');
    expect(eslintrc).toContain('no-direct-db-in-routes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② TenantRepository — withTenantContext 위임
// ─────────────────────────────────────────────────────────────────────────────

describe('② TenantRepository — withTenantContext 위임', () => {
  it('TenantRepository 기반 클래스가 export 되어야 한다', async () => {
    const module = await import('../../repositories/tenant-repository.js');
    expect(module.TenantRepository).toBeDefined();
    expect(module.StudentRepository).toBeDefined();
    expect(module.EwsRiskScoreRepository).toBeDefined();
    expect(module.HeartbeatRunRepository).toBeDefined();
    expect(module.AuditLogRepository).toBeDefined();
  });

  it('StudentRepository는 TenantRepository를 상속해야 한다', async () => {
    const { StudentRepository, TenantRepository } = await import(
      '../../repositories/tenant-repository.js'
    );
    const repo = new StudentRepository();
    expect(repo).toBeInstanceOf(TenantRepository);
  });

  it('EwsRiskScoreRepository는 TenantRepository를 상속해야 한다', async () => {
    const { EwsRiskScoreRepository, TenantRepository } = await import(
      '../../repositories/tenant-repository.js'
    );
    expect(new EwsRiskScoreRepository()).toBeInstanceOf(TenantRepository);
  });

  it('HeartbeatRunRepository는 TenantRepository를 상속해야 한다', async () => {
    const { HeartbeatRunRepository, TenantRepository } = await import(
      '../../repositories/tenant-repository.js'
    );
    expect(new HeartbeatRunRepository()).toBeInstanceOf(TenantRepository);
  });

  it('AuditLogRepository는 TenantRepository를 상속해야 한다', async () => {
    const { AuditLogRepository, TenantRepository } = await import(
      '../../repositories/tenant-repository.js'
    );
    expect(new AuditLogRepository()).toBeInstanceOf(TenantRepository);
  });

  it('protected withTenant 메서드는 withTenantContext를 감싸야 한다', () => {
    const repoSource = readFileSync(
      path.join(ROOT, 'server/src/repositories/tenant-repository.ts'),
      'utf-8',
    );
    expect(repoSource).toContain('withTenantContext');
    expect(repoSource).toContain('protected withTenant');
  });

  it('Repository 메서드들이 this.withTenant()를 통해 호출해야 한다', () => {
    const repoSource = readFileSync(
      path.join(ROOT, 'server/src/repositories/tenant-repository.ts'),
      'utf-8',
    );
    // withTenant 호출 횟수 — 각 public 메서드가 반드시 사용해야 함
    const callCount = (repoSource.match(/this\.withTenant/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(7); // 5개 Repository x 최소 1개 이상
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ tenant-assert — assertTenantExists
// ─────────────────────────────────────────────────────────────────────────────

describe('③ assertTenantExists — RLS 컨텍스트 인식 404', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('리소스가 있으면 조용히 통과해야 한다', async () => {
    const resource = { id: 'abc', name: 'Course A' };
    expect(() =>
      assertTenantExists(resource, {
        resourceType: 'course',
        resourceId: 'abc',
        institutionId: 'inst-001',
      }),
    ).not.toThrow();
  });

  it('리소스가 null 이면 RlsNotFoundError를 throw해야 한다', async () => {
    expect(() =>
      assertTenantExists(null, {
        resourceType: 'student',
        resourceId: 'stu-999',
        institutionId: 'inst-b',
      }),
    ).toThrow(RlsNotFoundError);
  });

  it('throw 된 RlsNotFoundError의 statusCode는 404여야 한다', async () => {
    let caught: RlsNotFoundError | null = null;
    try {
      assertTenantExists(undefined, {
        resourceType: 'agent',
        resourceId: 'ag-123',
        institutionId: 'inst-c',
      });
    } catch (e) {
      caught = e as RlsNotFoundError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.statusCode).toBe(404);
    expect(caught!.resourceType).toBe('agent');
    expect(caught!.resourceId).toBe('ag-123');
  });

  it('warn 로그에 RLS_NOT_FOUND 이벤트가 기록되어야 한다', async () => {
    try {
      assertTenantExists(null, {
        resourceType: 'course',
        resourceId: 'c-999',
        institutionId: 'inst-a',
      });
    // eslint-disable-next-line no-empty
    } catch {}

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logArg = consoleSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(logArg);
    expect(parsed.event).toBe('RLS_NOT_FOUND');
    expect(parsed.resourceType).toBe('course');
    expect(parsed.institutionId).toBe('inst-a');
  });

  it('req 컨텍스트가 있으면 method/path가 로그에 포함되어야 한다', async () => {
    const mockReq = { method: 'GET', path: '/courses/c-999', ip: '127.0.0.1', headers: {} } as never;
    try {
      assertTenantExists(null, {
        resourceType: 'course',
        resourceId: 'c-999',
        institutionId: 'inst-a',
        req: mockReq,
      });
    // eslint-disable-next-line no-empty
    } catch {}

    const logArg = consoleSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(logArg);
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/courses/c-999');
  });

  it('클라이언트가 받는 에러 메시지에는 RLS/기관 정보가 없어야 한다', async () => {
    let err: RlsNotFoundError | null = null;
    try {
      assertTenantExists(null, {
        resourceType: 'student',
        resourceId: 's-001',
        institutionId: 'inst-secret',
      });
    } catch (e) {
      err = e as RlsNotFoundError;
    }
    // 클라이언트 메시지에 기관 ID가 노출되지 않아야 함
    expect(err!.message).not.toContain('inst-secret');
    expect(err!.message).toBe('student not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ warnIfRlsEmpty
// ─────────────────────────────────────────────────────────────────────────────

describe('③ warnIfRlsEmpty — 빈 목록 RLS 로깅', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('결과가 있으면 로그를 남기지 않아야 한다', async () => {
    warnIfRlsEmpty(
      [{ id: 'a' }, { id: 'b' }],
      { resourceType: 'student', institutionId: 'inst-001', collectionName: 'students' },
    );
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('결과가 비어있으면 RLS_EMPTY_RESULT 로그를 남겨야 한다', async () => {
    warnIfRlsEmpty(
      [],
      { resourceType: 'student', institutionId: 'inst-001', collectionName: 'students' },
    );
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const logArg = infoSpy.mock.calls[0][1] as string;
    const parsed = JSON.parse(logArg);
    expect(parsed.event).toBe('RLS_EMPTY_RESULT');
    expect(parsed.collection).toBe('students');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ rlsErrorHandler — Express 에러 핸들러
// ─────────────────────────────────────────────────────────────────────────────

describe('③ rlsErrorHandler — Express 통합', () => {
  it('RlsNotFoundError를 404 JSON으로 변환해야 한다', async () => {
    const err = new RlsNotFoundError({
      message: 'course not found',
      resourceType: 'course',
      resourceId: 'c-1',
      institutionId: 'inst-1',
    });

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    rlsErrorHandler(err, {} as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'course not found' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('다른 에러는 next()로 위임해야 한다', async () => {
    const err = new Error('other error');
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    rlsErrorHandler(err, {} as never, res as never, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('rlsErrorHandler가 server/src/index.ts에 등록되어야 한다', () => {
    const indexSource = readFileSync(
      path.join(ROOT, 'server/src/index.ts'),
      'utf-8',
    );
    expect(indexSource).toContain('rlsErrorHandler');
    expect(indexSource).toContain('tenant-assert.js');
  });
});
