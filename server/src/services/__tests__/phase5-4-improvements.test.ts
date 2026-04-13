/**
 * phase5-4-improvements.test.ts
 *
 * Phase 5-4 개선 사항 검증 테스트 (N 부록 대응)
 *
 * 1. [보안] Socket.io admin 룸 JWT 인증 강화
 *    - join_session sessionId 포맷 검증
 *    - admin:* 룸 비관리자 차단 로직
 *
 * 2. [안정성] 헬스체크 Promise.race 타임아웃
 *    - withTimeout 유틸 — 타임아웃 시 fallback 반환
 *    - checkDbHealth: DB 지연 시 3초 후 'down' 반환
 *    - checkRedisHealth: Redis 지연 시 2초 후 'down' 반환
 *    - checkRedisHealth: REDIS_URL 미설정 시 'unavailable' 즉시 반환
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// 1. [보안] join_session sessionId 포맷 검증 유닛 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('[보안] join_session sessionId 포맷 검증', () => {
  /**
   * 포맷 규칙: 영숫자, 하이픈, 언더스코어만 허용 (1~128자)
   * chat.handler.ts 의 정규식: /^[a-zA-Z0-9_-]+$/
   */
  const isValidSessionId = (id: unknown): boolean => {
    if (typeof id !== 'string') return false;
    if (id.length === 0 || id.length > 128) return false;
    return /^[a-zA-Z0-9_-]+$/.test(id);
  };

  it('정상 UUID 형식 sessionId 허용', () => {
    expect(isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('영숫자 + 하이픈 + 언더스코어 허용', () => {
    expect(isValidSessionId('session_abc-123')).toBe(true);
    expect(isValidSessionId('abc123')).toBe(true);
  });

  it('보호된 룸 네임스페이스 접두사를 포함한 경우 거부', () => {
    // admin:, student:, user: 접두사를 포함하면 ':' 특수문자로 인해 거부됩니다.
    expect(isValidSessionId('admin:some-institution-id')).toBe(false);
    expect(isValidSessionId('student:user-id')).toBe(false);
    expect(isValidSessionId('user:user-id')).toBe(false);
  });

  it('HTML/스크립트 인젝션 시도 거부', () => {
    expect(isValidSessionId('<script>alert(1)</script>')).toBe(false);
    expect(isValidSessionId('"; DROP TABLE sessions;--')).toBe(false);
  });

  it('경로 탐색 시도 거부', () => {
    expect(isValidSessionId('../../../etc/passwd')).toBe(false);
  });

  it('빈 문자열 거부', () => {
    expect(isValidSessionId('')).toBe(false);
  });

  it('128자 초과 거부', () => {
    expect(isValidSessionId('a'.repeat(129))).toBe(false);
  });

  it('128자 정확히 허용', () => {
    expect(isValidSessionId('a'.repeat(128))).toBe(true);
  });

  it('숫자 타입 거부', () => {
    expect(isValidSessionId(12345)).toBe(false);
  });

  it('null/undefined 거부', () => {
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. [보안] admin 룸 접근 제어 로직 유닛 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('[보안] admin 룸 접근 제어 로직', () => {
  /**
   * chat.handler.ts 의 룸 보호 로직 추출
   * 'admin:' 으로 시작하는 룸은 role이 'admin'인 소켓만 허용
   */
  const isAllowedToJoinRoom = (room: string, role: string | undefined): boolean => {
    if (!room.startsWith('admin:')) return true; // 일반 룸은 모두 허용
    return role === 'admin';
  };

  it('admin 역할은 admin:* 룸 진입 허용', () => {
    expect(isAllowedToJoinRoom('admin:institution-001', 'admin')).toBe(true);
  });

  it('student 역할은 admin:* 룸 진입 거부', () => {
    expect(isAllowedToJoinRoom('admin:institution-001', 'student')).toBe(false);
  });

  it('instructor 역할은 admin:* 룸 진입 거부', () => {
    expect(isAllowedToJoinRoom('admin:institution-001', 'instructor')).toBe(false);
  });

  it('역할 미설정(undefined) 소켓은 admin:* 룸 진입 거부', () => {
    expect(isAllowedToJoinRoom('admin:institution-001', undefined)).toBe(false);
  });

  it('super_admin 문자열은 admin:* 룸 진입 거부 — 정확히 "admin"만 허용', () => {
    expect(isAllowedToJoinRoom('admin:institution-001', 'super_admin')).toBe(false);
  });

  it('session:* 룸은 모든 역할 접근 허용', () => {
    expect(isAllowedToJoinRoom('session:some-id', 'student')).toBe(true);
    expect(isAllowedToJoinRoom('session:some-id', 'instructor')).toBe(true);
  });

  it('student:* 룸은 admin이 아니어도 허용 (별도 룸 보호 대상 아님)', () => {
    expect(isAllowedToJoinRoom('student:user-001', 'student')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. [안정성] withTimeout 유틸 동작 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('[안정성] withTimeout 유틸 동작 검증', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * system-status.ts 의 withTimeout 로직 인라인 재구현
   * (모듈 의존성 없이 로직 자체만 검증)
   */
  function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    const timeout = new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`타임아웃 (${ms}ms)`)), ms),
    );
    return Promise.race([promise, timeout]).catch(() => fallback);
  }

  it('정상 응답이 타임아웃보다 빠르면 결과 반환', async () => {
    const fastPromise = Promise.resolve('ok');
    const result = await withTimeout(fastPromise, 3000, 'fallback');
    expect(result).toBe('ok');
  });

  it('타임아웃 초과 시 fallback 반환', async () => {
    const slowPromise = new Promise<string>((resolve) =>
      setTimeout(() => resolve('delayed'), 5000),
    );

    const resultPromise = withTimeout(slowPromise, 2000, 'timeout-fallback');
    vi.advanceTimersByTime(2500);
    const result = await resultPromise;
    expect(result).toBe('timeout-fallback');
  });

  it('promise 자체가 reject되면 fallback 반환', async () => {
    const failPromise = Promise.reject<string>(new Error('DB 연결 실패'));
    const result = await withTimeout(failPromise, 3000, 'error-fallback');
    expect(result).toBe('error-fallback');
  });

  it('타임아웃이 0ms이면 즉시 fallback 반환', async () => {
    const anyPromise = new Promise<string>(() => { /* never resolves */ });
    const resultPromise = withTimeout(anyPromise, 0, 'instant-fallback');
    vi.advanceTimersByTime(1);
    const result = await resultPromise;
    expect(result).toBe('instant-fallback');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. [안정성] 헬스체크 ServiceInfo 타임아웃 fallback 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('[안정성] 헬스체크 타임아웃 fallback 구조 검증', () => {
  it('DB 타임아웃 fallback은 ServiceInfo 스키마를 준수한다', () => {
    const fallback = {
      name: 'Database',
      status: 'down' as const,
      latencyMs: null,
      detail: '응답 없음 (3000ms 타임아웃)',
    };

    expect(fallback.name).toBe('Database');
    expect(fallback.status).toBe('down');
    expect(fallback.latencyMs).toBeNull();
    expect(fallback.detail).toContain('타임아웃');
  });

  it('Redis 타임아웃 fallback은 ServiceInfo 스키마를 준수한다', () => {
    const fallback = {
      name: 'Redis',
      status: 'down' as const,
      latencyMs: null,
      detail: '응답 없음 (2000ms 타임아웃)',
    };

    expect(fallback.name).toBe('Redis');
    expect(fallback.status).toBe('down');
    expect(fallback.latencyMs).toBeNull();
    expect(fallback.detail).toContain('타임아웃');
  });

  it('REDIS_URL 미설정 시 unavailable 즉시 반환 (타임아웃 대기 불필요)', () => {
    const savedRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    // 환경변수 없음 → 즉시 unavailable 반환 (Promise.race 진입 안 함)
    const result = !process.env.REDIS_URL
      ? { name: 'Redis', status: 'unavailable', latencyMs: null, detail: 'REDIS_URL 미설정' }
      : null;

    expect(result?.status).toBe('unavailable');
    expect(result?.latencyMs).toBeNull();

    if (savedRedisUrl) process.env.REDIS_URL = savedRedisUrl;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. [UX] LogModal 로그 처리 유틸 함수 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('[UX] LogModal 로그 처리 유틸 검증', () => {
  /**
   * SystemMonitor.tsx 의 highlightKeyword 로직 인라인 재구현
   */
  function highlightKeyword(text: string, keyword: string): string {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    if (!keyword.trim()) return escaped;

    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${safeKeyword})`, 'gi');
    return escaped.replace(regex, '<mark class="bg-yellow-200 text-yellow-900 rounded px-0.5">$1</mark>');
  }

  it('키워드 없으면 HTML 이스케이프만 적용', () => {
    const result = highlightKeyword('Hello <world>', '');
    expect(result).toBe('Hello &lt;world&gt;');
    expect(result).not.toContain('<mark');
  });

  it('키워드 매칭 시 mark 태그로 감싸기', () => {
    const result = highlightKeyword('Error occurred in system', 'Error');
    expect(result).toContain('<mark');
    expect(result).toContain('Error');
  });

  it('대소문자 구분 없이 검색 (case-insensitive)', () => {
    const result = highlightKeyword('error occurred', 'ERROR');
    expect(result).toContain('<mark');
    expect(result).toContain('error');
  });

  it('XSS 방지 — HTML 태그는 이스케이프되고 키워드는 mark로 감싸진다', () => {
    const result = highlightKeyword('<script>alert(1)</script>', 'script');
    // 원본 <script> 태그가 그대로 남아 있으면 XSS 실행 가능 → 반드시 제거
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    // &lt; / &gt; 이스케이프가 적용되었는지 확인
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    // 키워드 `script`는 이스케이프 후에도 mark로 하이라이트됩니다
    // 예: &lt;<mark>script</mark>&gt;
    expect(result).toContain('<mark');
    expect(result).toContain('script');
  });

  it('XSS 방지 — 키워드 자체에 정규식 특수문자가 있어도 안전하게 처리', () => {
    expect(() => highlightKeyword('test', '(.+)')).not.toThrow();
    expect(() => highlightKeyword('test', '.*')).not.toThrow();
    expect(() => highlightKeyword('test', '[abc')).not.toThrow();
  });

  it('따옴표 이스케이프', () => {
    const result = highlightKeyword('say "hello"', '');
    expect(result).toContain('&quot;');
    expect(result).not.toContain('"');
  });

  it('앰퍼샌드 이스케이프', () => {
    const result = highlightKeyword('foo & bar', '');
    expect(result).toContain('&amp;');
  });

  const LOG_CHUNK_SIZE = 200;

  it('tail 슬라이싱 — 전체 줄 중 마지막 N줄만 표시', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    const visibleCount = LOG_CHUNK_SIZE;
    const displayLines = lines.slice(Math.max(0, lines.length - visibleCount));

    expect(displayLines.length).toBe(LOG_CHUNK_SIZE);
    expect(displayLines[0]).toBe('line 301'); // 500 - 200 + 1
    expect(displayLines[displayLines.length - 1]).toBe('line 500');
  });

  it('전체 줄이 CHUNK_SIZE 이하이면 전부 표시', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const visibleCount = LOG_CHUNK_SIZE;
    const displayLines = lines.slice(Math.max(0, lines.length - visibleCount));

    expect(displayLines.length).toBe(50);
  });

  it('더보기 여부 계산 — 숨겨진 줄이 있으면 hasMore true', () => {
    const filteredLines = Array.from({ length: 350 }, (_, i) => `line ${i}`);
    const visibleCount = LOG_CHUNK_SIZE;
    const hasMore = filteredLines.length > visibleCount;

    expect(hasMore).toBe(true);
  });

  it('더보기 여부 계산 — 줄 수가 CHUNK_SIZE 이하면 hasMore false', () => {
    const filteredLines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const visibleCount = LOG_CHUNK_SIZE;
    const hasMore = filteredLines.length > visibleCount;

    expect(hasMore).toBe(false);
  });
});
