/**
 * 인증 헤더를 자동으로 포함하는 fetch 래퍼
 *
 * localStorage의 openmento_token에서 JWT를 읽어
 * Authorization: Bearer <token> 헤더를 자동으로 추가합니다.
 */

const TOKEN_KEY = 'openmento_token';

export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = {
    ...getAuthHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(input, { ...init, headers });
}
