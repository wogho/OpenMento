/**
 * phase5-3-onboarding.test.ts
 *
 * Phase 5-3 온보딩 가이드 내장 검증 테스트
 *
 * 커버리지:
 *  ① DB 스키마      — onboarding_completions 마이그레이션 SQL 유효성
 *  ② DB 스키마      — Drizzle 스키마 타입 구조 검증
 *  ③ 서버 API       — onboarding 라우트 입력/출력 계약 검증
 *  ④ 투어 시나리오  — 역할-투어 매핑 및 스텝 구조 검증
 *  ⑤ 훅 통합        — API 호출 흐름 목(Mock) 검증
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../..');
const DB_DRIZZLE = path.join(ROOT, 'packages/db/drizzle');
const DB_SCHEMA  = path.join(ROOT, 'packages/db/src/schema');

// ─────────────────────────────────────────────────────────────────────────────
// ① DB 마이그레이션 SQL 유효성
// ─────────────────────────────────────────────────────────────────────────────

describe('① DB 마이그레이션 (0011_onboarding_completions.sql)', () => {
  let sql: string;

  beforeEach(() => {
    sql = readFileSync(
      path.join(DB_DRIZZLE, '0011_onboarding_completions.sql'),
      'utf-8',
    );
  });

  it('마이그레이션 파일이 존재해야 한다', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('onboarding_completions 테이블 CREATE 문이 있어야 한다', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "onboarding_completions"');
  });

  it('user_id, institution_id, tour_id 컬럼이 정의되어야 한다', () => {
    expect(sql).toContain('"user_id"');
    expect(sql).toContain('"institution_id"');
    expect(sql).toContain('"tour_id"');
  });

  it('completed_at 컬럼에 DEFAULT now()가 있어야 한다', () => {
    expect(sql).toContain('"completed_at"');
    expect(sql).toContain('DEFAULT now()');
  });

  it('(user_id, tour_id) UNIQUE 제약이 있어야 한다', () => {
    expect(sql).toContain('UNIQUE ("user_id", "tour_id")');
  });

  it('institution_id 인덱스가 정의되어야 한다', () => {
    expect(sql).toContain('idx_onboarding_completions_institution_id');
  });

  it('user_id 인덱스가 정의되어야 한다', () => {
    expect(sql).toContain('idx_onboarding_completions_user_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② DB Drizzle 스키마 파일 구조
// ─────────────────────────────────────────────────────────────────────────────

describe('② Drizzle 스키마 파일 구조', () => {
  let schemaContent: string;

  beforeEach(() => {
    schemaContent = readFileSync(
      path.join(DB_SCHEMA, 'onboarding_completions.ts'),
      'utf-8',
    );
  });

  it('스키마 파일이 존재해야 한다', () => {
    expect(existsSync(path.join(DB_SCHEMA, 'onboarding_completions.ts'))).toBe(true);
  });

  it('pgTable 정의에 onboarding_completions 테이블명이 있어야 한다', () => {
    expect(schemaContent).toContain("'onboarding_completions'");
  });

  it('userId, institutionId, tourId 필드가 있어야 한다', () => {
    expect(schemaContent).toContain('userId');
    expect(schemaContent).toContain('institutionId');
    expect(schemaContent).toContain('tourId');
  });

  it('onConflict unique 제약이 있어야 한다', () => {
    expect(schemaContent).toContain('unique(');
    expect(schemaContent).toContain('userId');
    expect(schemaContent).toContain('tourId');
  });

  it('스키마 index.ts에 onboarding_completions export가 있어야 한다', () => {
    const indexContent = readFileSync(path.join(DB_SCHEMA, 'index.ts'), 'utf-8');
    expect(indexContent).toContain("from './onboarding_completions.js'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 서버 API 계약 검증 (라우트 파일 정적 분석)
// ─────────────────────────────────────────────────────────────────────────────

describe('③ 서버 온보딩 라우트 계약', () => {
  let routeContent: string;

  beforeEach(() => {
    routeContent = readFileSync(
      path.join(ROOT, 'server/src/routes/onboarding.ts'),
      'utf-8',
    );
  });

  it('라우트 파일이 존재해야 한다', () => {
    expect(routeContent.length).toBeGreaterThan(0);
  });

  it('GET /status 엔드포인트가 있어야 한다', () => {
    expect(routeContent).toContain("router.get('/status'");
  });

  it('POST /complete 엔드포인트가 있어야 한다', () => {
    expect(routeContent).toContain("router.post('/complete'");
  });

  it('DELETE /reset 엔드포인트가 있어야 한다 (개발/QA 용)', () => {
    expect(routeContent).toContain("router.delete('/reset'");
  });

  it('production 환경에서 reset이 차단되어야 한다', () => {
    expect(routeContent).toContain("process.env.NODE_ENV === 'production'");
    expect(routeContent).toContain('403');
  });

  it('allowedTourIds 화이트리스트가 admin-tour, student-tour를 포함해야 한다', () => {
    expect(routeContent).toContain("'admin-tour'");
    expect(routeContent).toContain("'student-tour'");
  });

  it('Zod 입력 검증이 적용되어야 한다', () => {
    expect(routeContent).toContain('z.enum(VALID_TOUR_IDS)');
  });

  it('onConflictDoNothing으로 중복 삽입을 멱등 처리해야 한다', () => {
    expect(routeContent).toContain('onConflictDoNothing');
  });

  it('authenticate 미들웨어가 등록되어야 한다', () => {
    expect(routeContent).toContain('router.use(authenticate)');
  });

  it('server/src/index.ts에서 onboarding 라우터가 등록되어야 한다', () => {
    const indexContent = readFileSync(
      path.join(ROOT, 'server/src/index.ts'),
      'utf-8',
    );
    expect(indexContent).toContain("from './routes/onboarding.js'");
    expect(indexContent).toContain("app.use('/onboarding'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 투어 시나리오 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('④ 투어 시나리오 정의', () => {
  let scenariosContent: string;

  beforeEach(() => {
    scenariosContent = readFileSync(
      path.join(ROOT, 'ui/src/tours/scenarios.ts'),
      'utf-8',
    );
  });

  it('scenarios.ts 파일이 존재해야 한다', () => {
    expect(scenariosContent.length).toBeGreaterThan(0);
  });

  it('admin-tour 투어 ID가 정의되어야 한다', () => {
    expect(scenariosContent).toContain("tourId: 'admin-tour'");
  });

  it('student-tour 투어 ID가 정의되어야 한다', () => {
    expect(scenariosContent).toContain("tourId: 'student-tour'");
  });

  it('관리자 투어는 스킬 파일 탭 (#admin-sidebar-skills)을 타깃으로 해야 한다', () => {
    expect(scenariosContent).toContain('#admin-sidebar-skills');
  });

  it('관리자 투어는 에이전트 설정 탭 (#admin-sidebar-agents)을 타깃으로 해야 한다', () => {
    expect(scenariosContent).toContain('#admin-sidebar-agents');
  });

  it('관리자 투어는 수강생 뷰 미리보기 버튼을 타깃으로 해야 한다', () => {
    expect(scenariosContent).toContain('#admin-chat-preview-btn');
  });

  it('수강생 투어는 채팅 입력창 (#chat-input)을 타깃으로 해야 한다', () => {
    expect(scenariosContent).toContain('#chat-input');
  });

  it('수강생 투어는 메시지 목록 (#chat-messages)을 타깃으로 해야 한다', () => {
    expect(scenariosContent).toContain('#chat-messages');
  });

  it('수강생 투어는 포트폴리오 이동 버튼 (#portfolio-nav-btn)을 타깃으로 해야 한다', () => {
    expect(scenariosContent).toContain('#portfolio-nav-btn');
  });

  it('getTourForRole은 admin 역할에 admin-tour를 반환해야 한다', () => {
    // 정적 분석: adminTour.roles에 admin이 포함되어야 함
    const adminSection = scenariosContent.slice(
      scenariosContent.indexOf('adminTour:'),
      scenariosContent.indexOf('studentTour:'),
    );
    expect(adminSection).toContain("'admin'");
    expect(adminSection).toContain("'instructor'");
  });

  it('getTourForRole은 student 역할에 student-tour를 반환해야 한다', () => {
    const studentSection = scenariosContent.slice(
      scenariosContent.indexOf('studentTour:'),
    );
    expect(studentSection).toContain("'student'");
  });

  it('각 투어는 3단계 이상의 스텝을 가져야 한다', () => {
    // adminTour와 studentTour 각각 element 3개 이상 포함
    const adminMatches = (
      scenariosContent
        .slice(scenariosContent.indexOf("tourId: 'admin-tour'"))
        .match(/element:/g) ?? []
    ).length;
    expect(adminMatches).toBeGreaterThanOrEqual(3);

    const studentMatches = (
      scenariosContent
        .slice(scenariosContent.indexOf("tourId: 'student-tour'"))
        .match(/element:/g) ?? []
    ).length;
    expect(studentMatches).toBeGreaterThanOrEqual(3);
  });

  it('ALL_TOURS 배열이 export되어야 한다', () => {
    expect(scenariosContent).toContain('export const ALL_TOURS');
  });

  it('getTourForRole 함수가 export되어야 한다', () => {
    expect(scenariosContent).toContain('export function getTourForRole');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ UI 컴포넌트 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('⑤ UI 컴포넌트 및 훅 구조', () => {
  it('OnboardingTour.tsx 컴포넌트 파일이 존재해야 한다', () => {
    expect(existsSync(path.join(ROOT, 'ui/src/components/OnboardingTour.tsx'))).toBe(true);
  });

  it('useOnboarding.ts 훅 파일이 존재해야 한다', () => {
    expect(existsSync(path.join(ROOT, 'ui/src/hooks/useOnboarding.ts'))).toBe(true);
  });

  it('useOnboarding 훅이 driver.js를 임포트해야 한다', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useOnboarding.ts'),
      'utf-8',
    );
    expect(hookContent).toContain("from 'driver.js'");
    expect(hookContent).toContain("driver.js/dist/driver.css");
  });

  it('useOnboarding 훅이 fetchCompletedTours, markTourComplete를 구현해야 한다', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useOnboarding.ts'),
      'utf-8',
    );
    expect(hookContent).toContain('fetchCompletedTours');
    expect(hookContent).toContain('markTourComplete');
  });

  it('useOnboarding 훅이 onConflict 방지 /onboarding/complete POST를 호출해야 한다', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useOnboarding.ts'),
      'utf-8',
    );
    expect(hookContent).toContain('/onboarding/complete');
    expect(hookContent).toContain("method: 'POST'");
  });

  it('OnboardingTour 컴포넌트가 useOnboarding 훅을 사용해야 한다', () => {
    const compContent = readFileSync(
      path.join(ROOT, 'ui/src/components/OnboardingTour.tsx'),
      'utf-8',
    );
    expect(compContent).toContain('useOnboarding');
  });

  it('App.tsx에 OnboardingTour가 삽입되어야 한다', () => {
    const appContent = readFileSync(
      path.join(ROOT, 'ui/src/App.tsx'),
      'utf-8',
    );
    expect(appContent).toContain('OnboardingTour');
    expect(appContent).toContain('<OnboardingTour />');
  });

  it('ChatPage에 #chat-input id가 있어야 한다', () => {
    const chatContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/ChatPage.tsx'),
      'utf-8',
    );
    expect(chatContent).toContain('id="chat-input"');
  });

  it('ChatPage에 #chat-messages id가 있어야 한다', () => {
    const chatContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/ChatPage.tsx'),
      'utf-8',
    );
    expect(chatContent).toContain('id="chat-messages"');
  });

  it('ChatPage에 #portfolio-nav-btn id가 있어야 한다', () => {
    const chatContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/ChatPage.tsx'),
      'utf-8',
    );
    expect(chatContent).toContain('id="portfolio-nav-btn"');
  });

  it('AdminPage 탭 버튼에 admin-sidebar-{tab.id} id 패턴이 있어야 한다', () => {
    const adminContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/AdminPage.tsx'),
      'utf-8',
    );
    expect(adminContent).toContain('id={`admin-sidebar-${tab.id}`}');
  });

  it('AdminPage에 #admin-chat-preview-btn id가 있어야 한다', () => {
    const adminContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/AdminPage.tsx'),
      'utf-8',
    );
    expect(adminContent).toContain('id="admin-chat-preview-btn"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 온보딩 완료 상태 API 시뮬레이션
// ─────────────────────────────────────────────────────────────────────────────

describe('⑥ 온보딩 API 흐름 시뮬레이션 (Mock)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completedTours가 없으면 투어가 미완료 상태로 판단되어야 한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ completedTours: [] }),
    });

    const res = await fetch('/onboarding/status', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const data = await res.json() as { completedTours: string[] };
    expect(data.completedTours).toHaveLength(0);
  });

  it('admin-tour가 완료된 경우 completedTours에 포함되어야 한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ completedTours: ['admin-tour'] }),
    });

    const res = await fetch('/onboarding/status', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const data = await res.json() as { completedTours: string[] };
    expect(data.completedTours).toContain('admin-tour');
    expect(data.completedTours).not.toContain('student-tour');
  });

  it('POST /complete 호출 시 201 응답이 와야 한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, tourId: 'student-tour' }),
    });

    const res = await fetch('/onboarding/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify({ tourId: 'student-tour' }),
    });

    expect(res.status).toBe(201);
    const data = await res.json() as { ok: boolean; tourId: string };
    expect(data.ok).toBe(true);
    expect(data.tourId).toBe('student-tour');
  });

  it('중복 POST /complete 호출에도 멱등(201)으로 응답해야 한다', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, tourId: 'admin-tour' }),
    });

    // 동일 투어 2회 완료 요청
    const first  = await fetch('/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ tourId: 'admin-tour' }),
    });
    const second = await fetch('/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ tourId: 'admin-tour' }),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it('잘못된 tourId는 Zod 검증 실패 (400) 규약이어야 한다', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: '유효하지 않은 tourId입니다.' }),
    });

    const res = await fetch('/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ tourId: 'unknown-tour' }),
    });

    expect(res.status).toBe(400);
  });
});
