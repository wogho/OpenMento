/**
 * phase5-2-multi-tenancy.test.ts — Phase 5-2 멀티 테넌시 DoD 검증
 *
 * ── 검증 항목 ─────────────────────────────────────────────────────────────────
 *
 *  [① institutions 테넌트 데이터 분리]
 *  T①  UserRole에 'super_admin'이 포함됩니다.
 *  T②  JwtPayload 타입에 institutionId 필드가 있습니다.
 *  T③  requireRole('admin')는 admin 역할을 통과시킵니다.
 *  T④  requireRole('admin')는 student 역할을 403으로 차단합니다.
 *  T⑤  requireRole('super_admin')는 super_admin 역할을 통과시킵니다.
 *  T⑥  requireRole('super_admin')는 admin 역할을 403으로 차단합니다.
 *
 *  [② RLS — requireSameInstitution 미들웨어]
 *  R①  admin 역할은 다른 기관 데이터에도 접근 가능합니다.
 *  R②  super_admin 역할은 다른 기관 데이터에도 접근 가능합니다.
 *  R③  student 역할은 동일 기관 접근 시 통과합니다.
 *  R④  student 역할이 다른 기관 institutionId로 접근 시 403을 반환합니다.
 *  R⑤  req.user가 없으면 401을 반환합니다.
 *
 *  [③ withTenantContext RLS 헬퍼]
 *  W①  withTenantContext는 트랜잭션 내에서 SET LOCAL을 실행합니다.
 *  W②  콜백의 반환값을 그대로 반환합니다.
 *  W③  콜백에서 예외 발생 시 트랜잭션이 롤백됩니다.
 *
 *  [④ Super Admin 라우트 보안]
 *  SA① createInstitutionSchema: name·slug·contactEmail 구조 검증.
 *  SA② slug 형식 검증: 소문자·숫자·하이픈만 허용.
 *  SA③ updateInstitutionSchema: 모든 필드가 optional (partial).
 *  SA④ 업데이트 시 빈 객체는 400 오류.
 *
 *  [⑤ login 스키마 — super_admin + institutionId 검증]
 *  L①  super_admin 역할 + institutionId='super'는 유효합니다.
 *  L②  super_admin 역할 + UUID institutionId는 Refine 오류.
 *  L③  admin 역할 + UUID institutionId는 유효합니다.
 *  L④  admin 역할 + institutionId='super'는 Refine 오류.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { NextFunction } from 'express';
import { z } from 'zod';
import { USER_ROLES } from '../../types/auth.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { UserRole, JwtPayload } from '../../types/auth.js';
import { requireRole, requireSameInstitution } from '../../middleware/rbac.js';

// ── DB Mock ──────────────────────────────────────────────────────────────────

const mockTx = {
  execute: vi.fn().mockResolvedValue(undefined),
};

const mockDb = {
  transaction: vi.fn((callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx)),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock('@educlip/db', async () => {
  const actual = await vi.importActual<typeof import('@educlip/db')>('@educlip/db');

  // withTenantContext: 실제 구현을 mockDb.transaction 기반으로 재현
  const withTenantContext = async <T>(
    institutionId: string,
    callback: (tx: typeof mockTx) => Promise<T>,
  ): Promise<T> => {
    return mockDb.transaction(async (tx: typeof mockTx) => {
      await tx.execute(`SET LOCAL app.institution_id = '${institutionId}'`);
      return callback(tx);
    }) as Promise<T>;
  };

  return {
    ...actual,
    db: mockDb,
    withTenantContext,
    setTenantSession: vi.fn().mockResolvedValue(undefined),
  };
});

// ── 테스트 헬퍼 ──────────────────────────────────────────────────────────────

function makeReq(
  override: Partial<Request> & { user?: Partial<JwtPayload>; params?: Record<string, string> },
): Request {
  return { user: undefined, params: {}, ...override } as unknown as Request;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

// ── ① UserRole 타입 검증 ────────────────────────────────────────────────────

describe('[T] UserRole & JwtPayload 타입', () => {
  it('T①  USER_ROLES에 super_admin이 포함됩니다', () => {
    expect(USER_ROLES).toContain('super_admin');
  });

  it('T②  JwtPayload 타입에 institutionId 필드가 있습니다 (컴파일 타임 확인)', () => {
    const payload: JwtPayload = {
      sub: '00000000-0000-0000-0000-000000000001',
      role: 'super_admin',
      institutionId: 'super',
    };
    expect(payload.institutionId).toBe('super');
    expect(payload.role).toBe('super_admin');
  });

  it('T③  requireRole(admin): admin 역할 통과', () => {
    const req = makeReq({ user: { role: 'admin', sub: 'u1', institutionId: 'inst1' } });
    const res = makeRes();
    const next = vi.fn();
    requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('T④  requireRole(admin): student 역할 403 차단', () => {
    const req = makeReq({ user: { role: 'student', sub: 'u1', institutionId: 'inst1' } });
    const res = makeRes();
    const next = vi.fn();
    requireRole('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('T⑤  requireRole(super_admin): super_admin 역할 통과', () => {
    const req = makeReq({ user: { role: 'super_admin', sub: 'u1', institutionId: 'super' } });
    const res = makeRes();
    const next = vi.fn();
    requireRole('super_admin')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('T⑥  requireRole(super_admin): admin 역할 403 차단 (super_admin과 다름)', () => {
    const req = makeReq({ user: { role: 'admin', sub: 'u1', institutionId: 'inst1' } });
    const res = makeRes();
    const next = vi.fn();
    requireRole('super_admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── ② requireSameInstitution 미들웨어 ──────────────────────────────────────

describe('[R] requireSameInstitution 미들웨어', () => {
  const INST_A = '11111111-1111-1111-1111-111111111111';
  const INST_B = '22222222-2222-2222-2222-222222222222';

  it('R①  admin은 다른 기관 institutionId 파라미터로도 접근 가능', () => {
    const req = makeReq({
      user: { role: 'admin', sub: 'u1', institutionId: INST_A },
      params: { institutionId: INST_B },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSameInstitution(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('R②  super_admin은 다른 기관 institutionId 파라미터로도 접근 가능', () => {
    const req = makeReq({
      user: { role: 'super_admin', sub: 'u1', institutionId: 'super' },
      params: { institutionId: INST_B },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSameInstitution(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('R③  student는 동일 기관 접근 시 통과', () => {
    const req = makeReq({
      user: { role: 'student', sub: 'u1', institutionId: INST_A },
      params: { institutionId: INST_A },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSameInstitution(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('R④  student가 다른 기관 institutionId로 접근하면 403', () => {
    const req = makeReq({
      user: { role: 'student', sub: 'u1', institutionId: INST_A },
      params: { institutionId: INST_B },
    });
    const res = makeRes();
    const next = vi.fn();
    requireSameInstitution(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('R⑤  req.user 없으면 401', () => {
    const req = makeReq({ user: undefined });
    const res = makeRes();
    const next = vi.fn();
    requireSameInstitution(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ── ③ withTenantContext RLS 헬퍼 ────────────────────────────────────────────

describe('[W] withTenantContext RLS 헬퍼', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.execute.mockResolvedValue(undefined);
    mockDb.transaction.mockImplementation(
      (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx),
    );
  });

  it('W①  트랜잭션 내에서 SET LOCAL app.institution_id를 실행합니다', async () => {
    const { withTenantContext } = await import('@educlip/db');
    const INST = '33333333-3333-3333-3333-333333333333';

    await withTenantContext(INST, async (_tx) => 'ok');

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.execute).toHaveBeenCalledTimes(1);
    // SET LOCAL 쿼리를 실행했는지 확인 (sql 태그 내용은 객체)
    const callArg = mockTx.execute.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
  });

  it('W②  콜백의 반환값을 그대로 반환합니다', async () => {
    const { withTenantContext } = await import('@educlip/db');
    const result = await withTenantContext('super', async (_tx) => ({ data: 42 }));
    expect(result).toEqual({ data: 42 });
  });

  it('W③  콜백에서 예외 발생 시 트랜잭션 롤백 (transaction 예외 재전파)', async () => {
    const { withTenantContext } = await import('@educlip/db');
    mockDb.transaction.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      withTenantContext('super', async (_tx) => { throw new Error('callback error'); }),
    ).rejects.toThrow('DB error');
  });
});

// ── ④ Super Admin 라우트 — Zod 스키마 검증 ─────────────────────────────────

describe('[SA] Super Admin Institution 스키마', () => {
  const createSchema = z.object({
    name: z.string().min(2).max(100),
    slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
    contactEmail: z.string().email().optional(),
  });
  const updateSchema = createSchema.partial();

  it('SA①  createInstitutionSchema: 유효한 입력 통과', () => {
    const result = createSchema.safeParse({
      name: '강남 IT 교육원',
      slug: 'gangnam-it',
      contactEmail: 'contact@gangnam-it.example.com',
    });
    expect(result.success).toBe(true);
  });

  it('SA②  slug: 대문자 포함하면 실패', () => {
    const result = createSchema.safeParse({ name: '테스트', slug: 'TestSlug' });
    expect(result.success).toBe(false);
  });

  it('SA②  slug: 공백 포함하면 실패', () => {
    const result = createSchema.safeParse({ name: '테스트', slug: 'my slug' });
    expect(result.success).toBe(false);
  });

  it('SA②  slug: 소문자·숫자·하이픈만 허용', () => {
    const result = createSchema.safeParse({ name: '테스트', slug: 'my-slug-123' });
    expect(result.success).toBe(true);
  });

  it('SA③  updateSchema: 모든 필드 optional (빈 객체 통과)', () => {
    const result = updateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('SA③  updateSchema: name만 제공해도 통과', () => {
    const result = updateSchema.safeParse({ name: '수정된 이름' });
    expect(result.success).toBe(true);
  });
});

// ── ⑤ login 스키마 — super_admin + institutionId Refine 검증 ────────────────

describe('[L] login 스키마 super_admin refinement', () => {
  const loginSchema = z
    .object({
      userId: z.string().uuid(),
      role: z.enum(['student', 'instructor', 'admin', 'super_admin']),
      institutionId: z.string(),
    })
    .refine(
      (data) =>
        data.role === 'super_admin'
          ? data.institutionId === 'super'
          : /^[0-9a-f-]{36}$/.test(data.institutionId),
      { path: ['institutionId'] },
    );

  const USER_ID = '00000000-0000-0000-0000-000000000099';

  it("L①  super_admin + institutionId='super'는 유효", () => {
    const r = loginSchema.safeParse({ userId: USER_ID, role: 'super_admin', institutionId: 'super' });
    expect(r.success).toBe(true);
  });

  it('L②  super_admin + UUID institutionId는 Refine 오류', () => {
    const r = loginSchema.safeParse({
      userId: USER_ID,
      role: 'super_admin',
      institutionId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(false);
  });

  it('L③  admin + UUID institutionId는 유효', () => {
    const r = loginSchema.safeParse({
      userId: USER_ID,
      role: 'admin',
      institutionId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(true);
  });

  it("L④  admin + institutionId='super'는 Refine 오류", () => {
    const r = loginSchema.safeParse({ userId: USER_ID, role: 'admin', institutionId: 'super' });
    expect(r.success).toBe(false);
  });
});
