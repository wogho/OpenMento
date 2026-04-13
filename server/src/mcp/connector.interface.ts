/**
 * MCP 커넥터 공통 인터페이스 (plan.md 1-3)
 *
 * 모든 외부 시스템 커넥터(LMS, 출결, GitHub 등)는 이 인터페이스를 구현합니다.
 * 인증 방식(OAuth 2.0 / API Key)은 ConnectorAuth 추상화로 커넥터 내부에 캡슐화됩니다.
 *
 * 보안 원칙 (plan.md 부록 B):
 *   - Read-only 기본 — Write는 명시적 승인이 있는 채널만 허용
 *   - 모든 외부 호출은 audit_logs 테이블에 반드시 기록
 */

// ── 인증 방식 추상화 ──────────────────────────────────────────────────────
export type AuthKind = 'api_key' | 'oauth2_client_credentials' | 'bearer_token';

export interface ApiKeyAuth {
  kind: 'api_key';
  headerName: string;    // 예: 'X-API-Key', 'Authorization'
  apiKey: string;
}

export interface OAuth2Auth {
  kind: 'oauth2_client_credentials';
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  /** 캐시된 액세스 토큰 — 커넥터 내부에서만 관리 */
  _cachedToken?: { value: string; expiresAt: number };
}

export interface BearerTokenAuth {
  kind: 'bearer_token';
  token: string;
}

export type ConnectorAuth = ApiKeyAuth | OAuth2Auth | BearerTokenAuth;

// ── 커넥터 설정 ───────────────────────────────────────────────────────────
export interface ConnectorConfig {
  /** 커넥터 고유 슬러그 (예: 'lms-myclass', 'attendance-hiclass') */
  slug: string;
  /** 외부 시스템 Base URL */
  baseUrl: string;
  /** 인증 정보 */
  auth: ConnectorAuth;
  /** 기관 UUID — 멀티 테넌트 컨텍스트 */
  institutionId: string;
  /** 요청 타임아웃 (ms, 기본 10000) */
  timeoutMs?: number;
}

// ── 외부 데이터 공통 타입 ─────────────────────────────────────────────────

export interface LmsCourseProgress {
  studentId: string;        // 외부 LMS 수강생 ID
  courseId: string;         // 외부 LMS 과목 ID
  progressPercent: number;  // 0~100
  lastAccessedAt: string;   // ISO 8601
  totalStudyMinutes: number;
}

export interface LmsQuizScore {
  studentId: string;
  quizId: string;
  quizTitle: string;
  score: number;       // 0~100
  maxScore: number;
  takenAt: string;     // ISO 8601
}

export interface AttendanceRecord {
  studentId: string;   // 외부 출결 시스템 수강생 ID
  courseId: string;
  date: string;        // YYYY-MM-DD
  status: 'present' | 'absent' | 'late' | 'excused';
}

// ── 커넥터 인터페이스 ─────────────────────────────────────────────────────
export interface IConnector {
  readonly slug: string;
  readonly institutionId: string;

  /** 연결 테스트 — 설정 저장 전 UI에서 호출 */
  ping(): Promise<{ ok: boolean; latencyMs: number }>;
}

export interface ILmsConnector extends IConnector {
  /** 강의 진도 조회 (수강생 전체 또는 특정 수강생) */
  getCourseProgress(courseId: string, studentId?: string): Promise<LmsCourseProgress[]>;
  /** 퀴즈 점수 조회 */
  getQuizScores(courseId: string, studentId?: string): Promise<LmsQuizScore[]>;
}

export interface IAttendanceConnector extends IConnector {
  /** 특정 날짜 범위 출결 기록 조회 */
  getAttendanceRecords(
    courseId: string,
    from: string,    // YYYY-MM-DD
    to: string,      // YYYY-MM-DD
    studentId?: string,
  ): Promise<AttendanceRecord[]>;
}
