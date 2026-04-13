/**
 * agent-auth-jwt.ts — Heartbeat 실행 전용 단기 JWT 발급 유틸리티
 *
 * plan.md 2-1: "단기 JWT 발급 패턴 (실행 시에만 유효한 토큰)"
 * paperclip `agent-auth-jwt.ts` 구조 차용 + 교육기관 도메인 확장
 *
 * 보안 원칙:
 * - 에이전트 실행 직전에만 JWT 를 발급하고 최대 15분 유효
 * - 장기 API 키가 런타임 코드에 노출되지 않도록 격리
 * - sub 클레임에 'agent:<agentId>' 형식으로 일반 사용자 토큰과 구분
 */

import jwt from 'jsonwebtoken';

// ── 타입 ────────────────────────────────────────────────────────────────────

/** Heartbeat 실행 시에만 발급되는 단기 JWT 페이로드 */
export interface AgentJwtPayload {
  /** 'agent:<agentId>' 형식 — 일반 사용자 sub 와 충돌 방지 */
  sub: string;
  /** 에이전트 UUID */
  agentId: string;
  /** 소속 교육기관 UUID (테넌트 격리) */
  institutionId: string;
  /** heartbeat_runs 실행 레코드 UUID (추적성) */
  runId: string;
  /** 토큰 종류 식별자 */
  type: 'agent_heartbeat';
  iat?: number;
  exp?: number;
}

// ── 상수 ────────────────────────────────────────────────────────────────────

/** 에이전트 단기 토큰 기본 유효 기간: 15분 */
const AGENT_TOKEN_TTL_SECONDS = 15 * 60;

// Fail-Fast: 모듈 로드 시점에 JWT_SECRET 검증
const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET 환경 변수가 설정되지 않았습니다. 에이전트 JWT 발급이 불가합니다.',
    );
  }
  return secret;
})();

// ── 공개 API ────────────────────────────────────────────────────────────────

/**
 * Heartbeat 실행에 필요한 단기 JWT 를 발급합니다.
 *
 * @param agentId       에이전트 UUID
 * @param institutionId 소속 기관 UUID
 * @param runId         heartbeat_runs 레코드 UUID
 * @param ttlSeconds    유효 시간 (기본 15분)
 * @returns 서명된 JWT 문자열
 */
export function issueAgentToken(
  agentId: string,
  institutionId: string,
  runId: string,
  ttlSeconds: number = AGENT_TOKEN_TTL_SECONDS,
): string {
  const payload: Omit<AgentJwtPayload, 'iat' | 'exp'> = {
    sub: `agent:${agentId}`,
    agentId,
    institutionId,
    runId,
    type: 'agent_heartbeat',
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ttlSeconds,
    algorithm: 'HS256',
  });
}

/**
 * 에이전트 단기 JWT 를 검증하고 페이로드를 반환합니다.
 *
 * @throws JsonWebTokenError / TokenExpiredError — 검증 실패 시
 */
export function verifyAgentToken(token: string): AgentJwtPayload {
  const payload = jwt.verify(token, JWT_SECRET) as AgentJwtPayload;

  if (payload.type !== 'agent_heartbeat') {
    throw new Error('유효하지 않은 에이전트 토큰 type 입니다.');
  }
  if (!payload.agentId || !payload.institutionId || !payload.runId) {
    throw new Error('에이전트 토큰 페이로드 필드가 누락되었습니다.');
  }

  return payload;
}
