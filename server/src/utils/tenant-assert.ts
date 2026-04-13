/**
 * tenant-assert.ts — RLS 컨텍스트 인식 리소스 검증 유틸리티
 *
 * Phase 5-2 ③ 404(Not Found) vs 403(Forbidden) 모호성 해결
 *
 * 배경:
 *   PostgreSQL RLS 가 활성화되면, 테넌트 A가 테넌트 B의 리소스 ID를 조회해도
 *   DB는 결과를 '0건(없음)'으로 반환합니다. 애플리케이션은 이를 404로 처리하며,
 *   이는 보안상 의도적 설계입니다(B가 존재한다는 사실 자체를 숨김).
 *
 *   그러나 이 패턴은 디버깅을 어렵게 합니다:
 *     - 실제로 존재하지 않는 리소스인지?
 *     - RLS 에 의해 숨겨진 것인지?
 *
 *   이 유틸리티는 두 케이스를 구분해 **서버 사이드 로그에만** 기록합니다.
 *   (클라이언트는 항상 404를 받아 보안을 유지)
 *
 * 사용 예시:
 *   const course = await repo.findById(req.user.institutionId, req.params.id);
 *   assertTenantExists(course, {
 *     resourceType: 'course',
 *     resourceId: req.params.id,
 *     institutionId: req.user.institutionId,
 *     req,
 *   });
 *   // course 가 null 이면 RLS_NOT_FOUND 로그 남기고 404 응답 throw
 */

import type { Request } from 'express';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface TenantAssertOptions {
  /** 리소스 종류 (로그용) e.g. 'student', 'course', 'agent' */
  resourceType: string;
  /** 조회한 리소스 ID */
  resourceId: string;
  /** 요청자의 institution ID */
  institutionId: string;
  /** Express Request (IP, method, path 등 로그 컨텍스트용) */
  req?: Request;
  /** 커스텀 에러 메시지 */
  message?: string;
}

/**
 * RLS 인식 404 에러 — 클라이언트에게는 일반 NotFoundError 처럼 동작하지만
 * 서버 로그에 RLS 컨텍스트 정보를 포함합니다.
 */
export class RlsNotFoundError extends Error {
  readonly statusCode = 404;
  readonly isRlsHidden: boolean;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly institutionId: string;

  constructor(opts: TenantAssertOptions & { isRlsHidden?: boolean }) {
    const msg = opts.message ?? `${opts.resourceType} not found`;
    super(msg);
    this.name = 'RlsNotFoundError';
    this.isRlsHidden = opts.isRlsHidden ?? false;
    this.resourceType = opts.resourceType;
    this.resourceId = opts.resourceId;
    this.institutionId = opts.institutionId;
  }
}

// ── 핵심 유틸리티 함수 ────────────────────────────────────────────────────────

/**
 * RLS 컨텍스트 인식 리소스 존재 체크.
 *
 * - 리소스가 존재하면 그대로 반환 (type narrowing)
 * - null 이면 서버 로그에 RLS 컨텍스트 기록 후 RlsNotFoundError throw
 *
 * @param resource - DB 쿼리 결과 (null 이면 없거나 RLS에 의해 필터됨)
 * @param opts     - 리소스 컨텍스트 정보
 * @throws RlsNotFoundError (statusCode: 404)
 */
export function assertTenantExists<T>(
  resource: T | null | undefined,
  opts: TenantAssertOptions,
): asserts resource is T {
  if (resource != null) return;

  const { resourceType, resourceId, institutionId, req } = opts;

  // 서버 사이드 구조화 로그 (클라이언트에게는 노출되지 않음)
  const logPayload = {
    event: 'RLS_NOT_FOUND',
    resourceType,
    resourceId,
    institutionId,
    // 요청 컨텍스트 (있을 때만)
    ...(req && {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      userId: (req as Request & { user?: { id?: string } }).user?.id,
    }),
    timestamp: new Date().toISOString(),
    hint:
      'This resource may not exist, OR it was hidden by RLS policy ' +
      '(cross-tenant access attempt). Only 404 is returned to client.',
  };

  // warn 레벨: 보안 이벤트이지만 정상 운영 중 빈번히 발생 가능
  console.warn('[TenantAssert]', JSON.stringify(logPayload));

  throw new RlsNotFoundError({ ...opts });
}

/**
 * DB 결과 배열이 비어있을 때 RLS 관련 경고 로그를 남깁니다.
 * 에러를 throw 하지 않고 단순히 로깅만 합니다.
 * (목록 조회 등에서 "결과 없음"이 정상인 경우에 사용)
 *
 * @param results       - DB 쿼리 result 배열
 * @param opts          - 컨텍스트 정보
 * @param expectedCount - 0이 아닐 것으로 기대되는 최소 개수 (기본: 0, 로그만)
 */
export function warnIfRlsEmpty<T>(
  results: T[],
  opts: Omit<TenantAssertOptions, 'resourceId'> & { collectionName: string },
  expectedCount = 0,
): void {
  if (results.length > expectedCount) return;

  const { resourceType, institutionId, collectionName, req } = opts;

  const logPayload = {
    event: 'RLS_EMPTY_RESULT',
    collection: collectionName,
    resourceType,
    institutionId,
    ...(req && {
      method: req.method,
      path: req.path,
      userId: (req as Request & { user?: { id?: string } }).user?.id,
    }),
    timestamp: new Date().toISOString(),
  };

  console.info('[TenantAssert]', JSON.stringify(logPayload));
}

// ── Express 에러 핸들러 통합 헬퍼 ─────────────────────────────────────────────

/**
 * RlsNotFoundError 를 Express JSON 응답으로 변환합니다.
 *
 * 사용 예시 (server/src/index.ts 에러 핸들러):
 *   app.use(rlsErrorHandler);
 */
export function rlsErrorHandler(
  err: unknown,
  _req: Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (err instanceof RlsNotFoundError) {
    // 클라이언트에게는 일반 404 메시지만 노출 (RLS 정보 숨김)
    res.status(404).json({
      error: err.message,
      resourceType: err.resourceType,
    });
    return;
  }
  next(err);
}
