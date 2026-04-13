/**
 * MCP 커넥터 공통 HTTP 헬퍼
 *
 * - ConnectorAuth 타입에 따라 Authorization 헤더를 자동 주입합니다.
 * - OAuth 2.0 Client Credentials: 토큰을 메모리에 캐시하고 만료 전 자동 갱신합니다.
 * - Circuit Breaker: 연속 5회 5xx/타임아웃 실패 시 60초 동안 요청 차단.
 * - 401 Auto Retry: OAuth2 캐시 토큰 만료로 인한 401 수신 시 재발급 후 1회 재시도.
 * - 타임아웃 + 에러 메시지 표준화를 처리합니다.
 */

import type { ConnectorAuth, OAuth2Auth } from './connector.interface.js';

// ── 에러 클래스 ───────────────────────────────────────────────────────────

/**
 * HTTP 오류 응답을 래핑합니다.
 * responseBody를 감사 로그(audit.ts)에 전달하기 위해 사용합니다.
 */
export class McpHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseBody: string,
    public readonly url: string,
    public readonly method: string,
  ) {
    super(`MCP 커넥터 요청 실패: ${method} ${url} → ${status} ${statusText}`);
    this.name = 'McpHttpError';
  }
}

/** 서킷 브레이커가 OPEN 상태일 때 throw됩니다 */
export class McpCircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpCircuitOpenError';
  }
}

// ── Circuit Breaker ───────────────────────────────────────────────────────

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerEntry {
  state: CircuitState;
  failureCount: number;
  openedAt?: number;
}

/** 연속 실패 N회 이후 서킷을 OPEN 상태로 전환합니다 */
const FAILURE_THRESHOLD = 5;
/** OPEN → HALF_OPEN 전환까지 대기 시간 (ms) */
const COOLDOWN_MS = 60_000;

// 외부 시스템 origin별 서킷 브레이커 상태를 메모리에 유지
const circuitMap = new Map<string, CircuitBreakerEntry>();

function getCircuit(origin: string): CircuitBreakerEntry {
  if (!circuitMap.has(origin)) {
    circuitMap.set(origin, { state: 'CLOSED', failureCount: 0 });
  }
  return circuitMap.get(origin)!;
}

function recordSuccess(origin: string): void {
  const cb = getCircuit(origin);
  cb.state = 'CLOSED';
  cb.failureCount = 0;
  cb.openedAt = undefined;
}

function recordFailure(origin: string): void {
  const cb = getCircuit(origin);
  if (cb.state === 'HALF_OPEN') {
    // HALF_OPEN 재시도 실패 → 다시 OPEN
    cb.state = 'OPEN';
    cb.openedAt = Date.now();
    return;
  }
  cb.failureCount += 1;
  if (cb.failureCount >= FAILURE_THRESHOLD) {
    cb.state = 'OPEN';
    cb.openedAt = Date.now();
  }
}

/**
 * 서킷 브레이커 통과 여부를 확인합니다.
 * - CLOSED / HALF_OPEN → 통과
 * - OPEN + 쿨다운 경과 → HALF_OPEN으로 전환 후 통과
 * - OPEN + 쿨다운 미경과 → McpCircuitOpenError throw
 */
function checkCircuit(origin: string): void {
  const cb = getCircuit(origin);
  if (cb.state === 'CLOSED' || cb.state === 'HALF_OPEN') return;

  const elapsed = Date.now() - (cb.openedAt ?? 0);
  if (elapsed >= COOLDOWN_MS) {
    cb.state = 'HALF_OPEN';
    return;
  }

  const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
  throw new McpCircuitOpenError(
    `[Circuit Breaker] ${origin} — 서킷 OPEN 상태 (${remaining}초 후 재시도 가능)`,
  );
}

// ── OAuth2 토큰 획득 (Client Credentials Grant) ───────────────────────────
async function fetchOAuth2Token(auth: OAuth2Auth): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    ...(auth.scope ? { scope: auth.scope } : {}),
  });

  const res = await fetch(auth.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 토큰 획득 실패: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };

  // 만료 10초 전에 갱신하도록 여유값 주기
  const expiresAt = Date.now() + ((data.expires_in ?? 3600) - 10) * 1000;
  auth._cachedToken = { value: data.access_token, expiresAt };

  return data.access_token;
}

// ── Bearer 토큰 해석 (인증 종류 불문) ────────────────────────────────────
async function resolveToken(auth: ConnectorAuth): Promise<string> {
  switch (auth.kind) {
    case 'api_key':
      return auth.apiKey;

    case 'bearer_token':
      return auth.token;

    case 'oauth2_client_credentials': {
      // 캐시된 토큰이 아직 유효하면 재사용
      if (auth._cachedToken && auth._cachedToken.expiresAt > Date.now()) {
        return auth._cachedToken.value;
      }
      return fetchOAuth2Token(auth);
    }
  }
}

// ── Authorization 헤더 조합 ───────────────────────────────────────────────
async function buildAuthHeader(auth: ConnectorAuth): Promise<Record<string, string>> {
  if (auth.kind === 'api_key') {
    return { [auth.headerName]: auth.apiKey };
  }
  const token = await resolveToken(auth);
  return { Authorization: `Bearer ${token}` };
}

// ── 표준 Fetch 래퍼 ──────────────────────────────────────────────────────
export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
}

/**
 * 인증 헤더를 주입하여 단일 HTTP 요청을 실행합니다.
 * connectorFetch의 재시도 로직과 분리된 순수 실행 함수입니다.
 */
async function executeRequest<T>(
  url: string,
  auth: ConnectorAuth,
  options: FetchOptions,
): Promise<T> {
  const { method = 'GET', body, timeoutMs = 10_000 } = options;
  const authHeader = await buildAuthHeader(auth);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeader,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      // 에러 응답 바디를 캡처하여 감사 로그에서 추적 가능하도록 McpHttpError로 래핑
      const responseBody = await res.text();
      throw new McpHttpError(res.status, res.statusText, responseBody, url, method);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 인증 헤더를 자동 주입하여 외부 시스템 API를 호출합니다.
 *
 * - Circuit Breaker: 연속 5회 5xx/타임아웃 실패 시 60초 동안 요청 차단
 * - 401 Auto Retry: OAuth2 캐시 토큰 만료 시 토큰 재발급 후 1회 재시도
 * - 타임아웃: AbortController 기반 강제 중단 (기본 10초)
 */
export async function connectorFetch<T>(
  url: string,
  auth: ConnectorAuth,
  options: FetchOptions = {},
): Promise<T> {
  const origin = new URL(url).origin;

  // ① 서킷 브레이커 — OPEN이면 즉시 McpCircuitOpenError throw
  checkCircuit(origin);

  try {
    const result = await executeRequest<T>(url, auth, options);
    recordSuccess(origin);
    return result;
  } catch (err) {
    // ② 401 수신 시: OAuth2 캐시 토큰 파기 → 재발급 → 1회 재시도
    if (
      err instanceof McpHttpError &&
      err.status === 401 &&
      auth.kind === 'oauth2_client_credentials'
    ) {
      auth._cachedToken = undefined; // 만료된 캐시 파기
      try {
        const retryResult = await executeRequest<T>(url, auth, options);
        recordSuccess(origin);
        return retryResult;
      } catch (retryErr) {
        // 재시도도 실패 → 서킷에 실패 기록 후 에러 전파
        recordFailure(origin);
        throw retryErr;
      }
    }

    // ③ 5xx 서버 에러 또는 타임아웃(AbortError) → 서킷 실패 카운트 증가
    //    4xx 클라이언트 에러(404, 400 등)는 서버 장애가 아니므로 카운트 제외
    if (
      (err instanceof McpHttpError && err.status >= 500) ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      recordFailure(origin);
    }

    throw err;
  }
}
