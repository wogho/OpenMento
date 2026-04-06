/**
 * E2E 테스트용 JWT 토큰 생성 헬퍼
 *
 * 실제 서버 없이 클라이언트의 decodeJwt()가 파싱할 수 있는
 * 표준 base64 인코딩 페이로드를 포함한 테스트 토큰을 생성한다.
 */

interface TokenPayload {
  sub: string;
  institutionId: string;
  role: 'student' | 'instructor' | 'admin';
  name: string;
  /** unix timestamp (초), 멀리 설정해 만료 걱정 없음 */
  exp: number;
  iat: number;
}

function makeToken(payload: TokenPayload): string {
  const enc = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64');
  const header = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  // 테스트용이므로 서명은 임의 문자열
  return `${header}.${body}.e2e-test-signature`;
}

const FAR_FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1년 후

/** 수강생 역할 테스트 토큰 */
export const STUDENT_TOKEN = makeToken({
  sub: 'student-e2e-001',
  institutionId: 'inst-test-001',
  role: 'student',
  name: '테스트 수강생',
  exp: FAR_FUTURE,
  iat: Math.floor(Date.now() / 1000),
});

/** 관리자 역할 테스트 토큰 */
export const ADMIN_TOKEN = makeToken({
  sub: 'admin-e2e-001',
  institutionId: 'inst-test-001',
  role: 'admin',
  name: '테스트 관리자',
  exp: FAR_FUTURE,
  iat: Math.floor(Date.now() / 1000),
});
