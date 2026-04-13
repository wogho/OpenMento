/**
 * security-headers.ts — OWASP Top 10 대응 보안 HTTP 헤더 미들웨어 (Phase 5-5)
 *
 * ── OWASP 대응 현황 ──────────────────────────────────────────────────────────
 *
 *   A01 Broken Access Control        → RBAC (rbac.ts) + JWT (auth.ts) ✅
 *   A02 Cryptographic Failures       → pgcrypto secrets (secrets-encryption.ts) ✅
 *   A03 Injection                    → Drizzle ORM 파라미터 바인딩 ✅
 *   A04 Insecure Design              → Schema validation (Zod) ✅
 *   A05 Security Misconfiguration    → 이 파일 (보안 헤더) ✅
 *   A06 Vulnerable Components        → pnpm audit (CI 단계에서 확인 권장)
 *   A07 Auth/Session Failures        → JWT Fail-Fast + Bearer-only ✅
 *   A08 Software Data Integrity      → HMAC webhook 서명 검증 ✅
 *   A09 Logging / Monitoring         → audit_logs + winston logger ✅
 *   A10 SSRF                         → fetch 대상이 OpenAI API 등 화이트리스트만 ✅
 *
 * ── 적용 헤더 ────────────────────────────────────────────────────────────────
 *
 *   X-Content-Type-Options: nosniff
 *     → MIME 스니핑 공격 방지 (A05)
 *
 *   X-Frame-Options: DENY
 *     → Clickjacking 방지 (A05)
 *
 *   X-XSS-Protection: 1; mode=block
 *     → 구형 브라우저 XSS 필터 활성화 (A05, deprecated but harmless)
 *
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     → URL 파라미터의 토큰 정보가 Referer 헤더로 유출되지 않도록 제한 (A02)
 *
 *   Permissions-Policy: camera=(), microphone=(), geolocation=()
 *     → 교육 플랫폼에서 불필요한 브라우저 API 접근 차단 (A05)
 *
 *   Content-Security-Policy (기본 정책)
 *     → XSS / 데이터 인젝션 방어 (A03)
 *     → API 서버이므로 default 차단 정책 사용, 클라이언트는 별도 CSP 적용 권장
 *
 *   Strict-Transport-Security (production만)
 *     → HTTPS 강제, MITM 공격 방지 (A02)
 *
 *   X-Powered-By 제거
 *     → 기술 스택 노출 방지 (A05)
 */

import type { Request, Response, NextFunction } from 'express';

// ── Content-Security-Policy 정책 ─────────────────────────────────────────────

/**
 * API 서버용 CSP 정책 (엄격 모드)
 *
 * - API 서버는 HTML 페이지를 직접 렌더링하지 않으므로
 *   `default-src 'none'` 으로 모든 리소스 로딩 차단
 * - 클라이언트(Next.js 프론트엔드)는 별도 CSP 설정 필요
 */
const CSP_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// ── HSTS 설정 (production만 활성화) ──────────────────────────────────────────

const HSTS_MAX_AGE = 63072000; // 2년 (초)

function getHstsHeader(): string {
  return `max-age=${HSTS_MAX_AGE}; includeSubDomains; preload`;
}

// ── 미들웨어 ──────────────────────────────────────────────────────────────────

/**
 * OWASP 보안 HTTP 헤더를 모든 응답에 추가합니다.
 *
 * server/src/index.ts에서 모든 라우트 앞에 마운트해야 합니다:
 *   app.use(securityHeaders);
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // MIME 스니핑 방지
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Clickjacking 방지
  res.setHeader('X-Frame-Options', 'DENY');

  // XSS 보호 (구형 브라우저 대응)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referer 헤더 제한
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 불필요한 브라우저 API 접근 차단
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Content-Security-Policy (API 서버 — 엄격 모드)
  res.setHeader('Content-Security-Policy', CSP_POLICY);

  // 기술 스택 노출 방지 (Express 기본값 'X-Powered-By: Express' 제거)
  res.removeHeader('X-Powered-By');

  // HSTS — production 환경에서만 활성화
  // (개발/테스트 환경에서 HSTS 적용 시 localhost HTTP 접근이 강제 차단될 수 있음)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', getHstsHeader());
  }

  next();
}
