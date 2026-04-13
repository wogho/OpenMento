// ── 역할 정의 ──────────────────────────────────────────────
// plan.md 부록 B: RBAC 접근 제어 /student/* /teacher/* /admin/*
// superadmin 제거, admin으로 통일. instructor → teacher 변경.
export const USER_ROLES = ['student', 'teacher', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ── Permissions 비트마스크 (admin_users.permissions 정수값) ─────────
// 각 비트가 개별 기능 접근 권한을 나타냄
export const PERMISSIONS = {
  VIEW_DASHBOARD:      1 << 0,  // 0001 - 대시보드 조회
  MANAGE_STUDENTS:     1 << 1,  // 0002 - 수강생 CRUD
  MANAGE_INSTRUCTORS:  1 << 2,  // 0004 - 강사 CRUD
  MANAGE_AGENTS:       1 << 3,  // 0008 - 에이전트 CRUD
  MANAGE_SKILLS:       1 << 4,  // 0016 - 스킬 CRUD
  MANAGE_DOCUMENTS:    1 << 5,  // 0032 - 교재 CRUD
  VIEW_COSTS:          1 << 6,  // 0064 - 비용 조회
  MANAGE_SECRETS:      1 << 7,  // 0128 - 시스템 키 관리
  MANAGE_INSTITUTIONS: 1 << 8,  // 0256 - 기관 관리 (최상위 admin 전용)
} as const;

// admin 기본 권한: 모든 권한
export const ADMIN_DEFAULT_PERMISSIONS = Object.values(PERMISSIONS).reduce((a, b) => a | b, 0);
// teacher 기본 권한: 대시보드, 수강생, 에이전트, 스킬, 교재 조회/관리
export const TEACHER_DEFAULT_PERMISSIONS =
  PERMISSIONS.VIEW_DASHBOARD | PERMISSIONS.MANAGE_STUDENTS |
  PERMISSIONS.MANAGE_AGENTS | PERMISSIONS.MANAGE_SKILLS | PERMISSIONS.MANAGE_DOCUMENTS;

// ── JWT 페이로드 ────────────────────────────────────────────
export interface JwtPayload {
  sub: string;           // userId (UUID)
  role: UserRole;
  institutionId: string; // 멀티 테넌트: 기관 격리
  institutionName?: string; // 소속 기관명 UI 표시용
  name?: string;         // 표시 이름 (선택)
  permissions?: number;  // Permissions 비트마스크
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
