// ── 역할 정의 ──────────────────────────────────────────────
// plan.md 부록 B: RBAC 접근 제어 /student/* /instructor/* /admin/*
// Phase 5-2: super_admin 추가 — 여러 교육기관 통합 관리
export const USER_ROLES = ['student', 'instructor', 'admin', 'super_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ── JWT 페이로드 ────────────────────────────────────────────
export interface JwtPayload {
  sub: string;           // userId (UUID)
  role: UserRole;
  institutionId: string; // 멀티 테넌트: 기관 격리 (super_admin은 'super' 고정값 사용)
  iat?: number;
  exp?: number;
}

// ── Express Request 전역 타입 확장 (Declaration Merging) ─────
// @types/express 네임스페이스 병합으로 모든 Request 객체에 user 추가
// authenticate 미들웨어 통과 후 req.user 를 캐스팅 없이 사용 가능
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
