/**
 * MCP 감사 로그 기록 유틸리티 (plan.md 1-3, 부록 B)
 *
 * 모든 외부 시스템(LMS, 출결, GitHub 등) 접근은
 * audit_logs 테이블에 반드시 기록되어야 합니다.
 *
 * 사용 방법:
 *   await logMcpAccess(db, { institutionId, actorId, action, resourceType, ... });
 *
 * 실패해도 메인 흐름을 막지 않도록 내부적으로 에러를 흡수합니다.
 */

import { db, auditLogs } from '@educlip/db';
import { McpHttpError } from './connector-fetch.js';

export interface McpAuditPayload {
  institutionId?: string;
  actorId?: string;
  actorType: 'agent' | 'instructor' | 'admin' | 'system';
  action: 'read' | 'write' | 'delete' | 'webhook_receive' | 'mcp_connector_call' | 'agent_run';
  resourceType: string;   // 'lms', 'attendance', 'github', 'openai'
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * 외부 시스템 접근 이력을 audit_logs 테이블에 비동기로 기록합니다.
 * 로그 저장 実패는 메인 비즈니스 로직에 영향을 주지 않습니다.
 */
export async function logMcpAccess(payload: McpAuditPayload): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      institutionId: payload.institutionId ?? null,
      actorId: payload.actorId ?? null,
      actorType: payload.actorType,
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId ?? null,
      metadata: payload.metadata ?? null,
      ipAddress: payload.ipAddress ?? null,
    });
  } catch {
    // 감사 로그 실패는 무시 — 메인 흐름에 영향을 주지 않음
    // Phase 5에서 별도 로그 수집 서비스로 교체 예정
  }
}

/**
 * 에이전트 CUD(Create·Update·Delete) 작업을 audit_logs 에 기록합니다.
 *
 * plan.md Phase 3 개선③: 에이전트 변경 감사 로그(Audit Trail) 연동
 * - resourceType = 'agent'
 * - metadata.operation: 'create' | 'update' | 'delete'
 * - metadata.before / metadata.after: 변경 전·후 스냅샷 (민감 키 제외)
 * - 로그 저장 실패는 메인 흐름에 영향 없이 무시합니다.
 */
export async function logAgentChange(
  payload: {
    institutionId: string;
    actorId: string;
    operation: 'create' | 'update' | 'delete';
    agentId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ipAddress?: string;
  },
  /** 테스트 주입용 — 생략 시 실제 logMcpAccess 사용 */
  _logFn: typeof logMcpAccess = logMcpAccess,
): Promise<void> {
  await _logFn({
    institutionId: payload.institutionId,
    actorId: payload.actorId,
    actorType: 'admin',
    action: payload.operation === 'delete' ? 'delete' : 'write',
    resourceType: 'agent',
    resourceId: payload.agentId,
    metadata: {
      operation: payload.operation,
      ...(payload.before !== undefined && { before: payload.before }),
      ...(payload.after !== undefined && { after: payload.after }),
    },
    ipAddress: payload.ipAddress,
  });
}

/**
 * 커넥터 호출을 감사 로그와 함께 실행하는 래퍼
 *
 * @example
 * const result = await withAuditLog(
 *   () => lmsConnector.getCourseProgress(courseId),
 *   { institutionId, actorId, actorType: 'agent', resourceType: 'lms', resourceId: courseId }
 * );
 */
export async function withAuditLog<T>(
  fn: () => Promise<T>,
  payload: McpAuditPayload,
): Promise<T> {
  // 선행 로그 (접근 시도 기록)
  await logMcpAccess({ ...payload, metadata: { ...payload.metadata, phase: 'request' } });

  try {
    const result = await fn();
    // 성공 후 로그 (결과 요약)
    await logMcpAccess({
      ...payload,
      metadata: {
        ...payload.metadata,
        phase: 'response',
        resultCount: Array.isArray(result) ? result.length : 1,
      },
    });
    return result;
  } catch (err) {
    // 실패 로그 — McpHttpError인 경우 HTTP 상태코드와 응답 바디를 함께 기록하여
    // 관리자가 GUI에서 외부 API 실패 원인을 정확히 추적할 수 있도록 합니다.
    const errorMeta: Record<string, unknown> = {
      ...payload.metadata,
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    };

    if (err instanceof McpHttpError) {
      errorMeta.httpStatus = err.status;
      errorMeta.httpStatusText = err.statusText;
      // 바디가 너무 길 경우를 대비해 2000자로 제한
      errorMeta.errorBody = err.responseBody.slice(0, 2_000);
    }

    await logMcpAccess({ ...payload, metadata: errorMeta });
    throw err;
  }
}
