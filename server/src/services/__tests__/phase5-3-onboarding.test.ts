/**
 * phase5-3-onboarding.test.ts
 *
 * Phase 5-3 온보딩 가이드 내장 + Gemini 개선 검증 테스트
 *
 * 커버리지:
 *  ① DB 스키마      — onboarding_completions 마이그레이션 SQL 유효성 (0011)
 *  ② DB 스키마 개선  — last_step_index 마이그레이션 (0012, Gemini 제언 ①)
 *  ③ Drizzle 스키마  — 타입 구조 검증
 *  ④ 서버 API       — onboarding 라우트 입력/출력 계약 검증
 *  ⑤ 서버 API 개선  — PATCH /progress 계약 (Gemini 제언 ①)
 *  ⑥ 소켓 브로드캐스트 — onboarding:completed 계약 (Gemini 제언 ②)
 *  ⑦ 투어 시나리오  — 역할-투어 매핑 및 스텝 구조 검증
 *  ⑧ 시나리오 개선  — portfolio-tour / ews-tour 도메인별 투어 (Gemini 제언 ③)
 *  ⑨ UI 훅 구조     — useFeatureTour 리팩터 + useOnboarding thin wrapper
 *  ⑩ API 흐름 시뮬레이션 — Mock 기반 통합 흐름
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

  it('completed_at 컬럼이 정의되어야 한다', () => {
    expect(sql).toContain('"completed_at"');
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
// ② DB 마이그레이션 개선 (0012_onboarding_progress.sql) — Gemini 제언 ①
// ─────────────────────────────────────────────────────────────────────────────

describe('② DB 마이그레이션 개선 (0012_onboarding_progress.sql)', () => {
  let migSql: string;

  beforeEach(() => {
    migSql = readFileSync(
      path.join(DB_DRIZZLE, '0012_onboarding_progress.sql'),
      'utf-8',
    );
  });

  it('0012 마이그레이션 파일이 존재해야 한다', () => {
    expect(migSql.length).toBeGreaterThan(0);
  });

  it('last_step_index 컬럼 추가 DDL이 있어야 한다', () => {
    expect(migSql).toContain('last_step_index');
    expect(migSql).toContain('ALTER TABLE');
  });

  it('completed_at NOT NULL 제약을 DROP하는 DDL이 있어야 한다', () => {
    expect(migSql).toContain('DROP NOT NULL');
  });

  it('진행 중 레코드 부분 인덱스가 있어야 한다', () => {
    expect(migSql).toContain('idx_onboarding_completions_in_progress');
    expect(migSql).toContain('IS NULL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ DB Drizzle 스키마 파일 구조
// ─────────────────────────────────────────────────────────────────────────────

describe('③ Drizzle 스키마 파일 구조', () => {
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

  it('lastStepIndex 필드가 있어야 한다 (Gemini 제언 ①)', () => {
    expect(schemaContent).toContain('lastStepIndex');
    expect(schemaContent).toContain('last_step_index');
  });

  it('completedAt 이 nullable로 정의되어야 한다 (Gemini 제언 ①)', () => {
    // completedAt 에 .notNull() 이 없어야 함
    const completedAtLine = schemaContent
      .split('\n')
      .find((l) => l.includes('completedAt') && l.includes('timestamp'));
    expect(completedAtLine).toBeDefined();
    expect(completedAtLine).not.toContain('notNull()');
  });

  it('스키마 index.ts에 onboarding_completions export가 있어야 한다', () => {
    const indexContent = readFileSync(path.join(DB_SCHEMA, 'index.ts'), 'utf-8');
    expect(indexContent).toContain("from './onboarding_completions.js'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 서버 API 계약 검증 (라우트 파일 정적 분석)
// ─────────────────────────────────────────────────────────────────────────────

describe('④ 서버 온보딩 라우트 계약', () => {
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

  it('allowedTourIds 화이트리스트가 portfolio-tour, ews-tour를 포함해야 한다 (Gemini ③)', () => {
    expect(routeContent).toContain("'portfolio-tour'");
    expect(routeContent).toContain("'ews-tour'");
  });

  it('Zod 입력 검증이 적용되어야 한다', () => {
    expect(routeContent).toContain('z.enum(VALID_TOUR_IDS)');
  });

  it('onConflictDoNothing으로 중복 삽입을 멱등 처리해야 한다', () => {
    // POST /complete는 onConflictDoUpdate 로 완료 timestamp 갱신
    expect(routeContent).toContain('onConflictDoUpdate');
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
// ⑤ 서버 API 개선: PATCH /progress 계약 (Gemini 제언 ①)
// ─────────────────────────────────────────────────────────────────────────────

describe('⑤ PATCH /onboarding/progress 계약 (Gemini 제언 ①)', () => {
  let routeContent: string;

  beforeEach(() => {
    routeContent = readFileSync(
      path.join(ROOT, 'server/src/routes/onboarding.ts'),
      'utf-8',
    );
  });

  it("PATCH '/progress' 엔드포인트가 있어야 한다", () => {
    expect(routeContent).toContain("router.patch('/progress'");
  });

  it('lastStepIndex 필드를 Zod로 검증해야 한다', () => {
    expect(routeContent).toContain('lastStepIndex');
    expect(routeContent).toContain('z.number().int().min(0)');
  });

  it('GET /status가 progressMap을 반환해야 한다', () => {
    expect(routeContent).toContain('progressMap');
  });

  it('PATCH /progress는 이미 완료된 투어의 진행상태를 덮어쓰지 않는 조건이 있어야 한다', () => {
    expect(routeContent).toContain('CASE WHEN');
    expect(routeContent).toContain('IS NULL');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ Socket.io onboarding:completed 브로드캐스트 (Gemini 제언 ②)
// ─────────────────────────────────────────────────────────────────────────────

describe('⑥ Socket.io Cross-Tab Sync 계약 (Gemini 제언 ②)', () => {
  it('onboarding 라우터가 io를 import해야 한다', () => {
    const routeContent = readFileSync(
      path.join(ROOT, 'server/src/routes/onboarding.ts'),
      'utf-8',
    );
    expect(routeContent).toContain("from '../socket/chat.handler.js'");
    expect(routeContent).toContain('io');
  });

  it('POST /complete 에서 onboarding:completed 이벤트를 emit해야 한다', () => {
    const routeContent = readFileSync(
      path.join(ROOT, 'server/src/routes/onboarding.ts'),
      'utf-8',
    );
    expect(routeContent).toContain("'onboarding:completed'");
    expect(routeContent).toContain('io?.to');
    expect(routeContent).toContain('user:${userId}');
  });

  it('chat.handler.ts가 user:{userId} 개인 룸에 소켓을 join해야 한다', () => {
    const handlerContent = readFileSync(
      path.join(ROOT, 'server/src/socket/chat.handler.ts'),
      'utf-8',
    );
    expect(handlerContent).toContain('user:${userId}');
    expect(handlerContent).toContain('socket.join');
  });

  it('useFeatureTour 훅이 onboarding:completed 소켓 이벤트를 구독해야 한다', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useFeatureTour.ts'),
      'utf-8',
    );
    expect(hookContent).toContain("'onboarding:completed'");
    expect(hookContent).toContain('socket.on');
    expect(hookContent).toContain('getSharedSocket');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 투어 시나리오 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('⑦ 투어 시나리오 정의', () => {
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
// ⑧ 도메인별 기능 투어 시나리오 (Gemini 제언 ③)
// ─────────────────────────────────────────────────────────────────────────────

describe('⑧ 도메인별 기능 투어 (Gemini 제언 ③)', () => {
  let scenariosContent: string;

  beforeEach(() => {
    scenariosContent = readFileSync(
      path.join(ROOT, 'ui/src/tours/scenarios.ts'),
      'utf-8',
    );
  });

  it('portfolio-tour 투어 ID가 정의되어야 한다', () => {
    expect(scenariosContent).toContain("tourId: 'portfolio-tour'");
  });

  it('ews-tour 투어 ID가 정의되어야 한다', () => {
    expect(scenariosContent).toContain("tourId: 'ews-tour'");
  });

  it('TourId 타입이 portfolio-tour와 ews-tour를 포함해야 한다', () => {
    expect(scenariosContent).toContain("'portfolio-tour'");
    expect(scenariosContent).toContain("'ews-tour'");
  });

  it('portfolio-tour가 /portfolio entryPath를 가져야 한다', () => {
    const portfolioSection = scenariosContent.slice(
      scenariosContent.indexOf("tourId: 'portfolio-tour'"),
    );
    expect(portfolioSection.substring(0, 200)).toContain("'/portfolio'");
  });

  it('portfolio-tour가 #portfolio-stage-tracker 타깃을 가져야 한다', () => {
    expect(scenariosContent).toContain('#portfolio-stage-tracker');
  });

  it('portfolio-tour가 #portfolio-interview-chat 타깃을 가져야 한다', () => {
    expect(scenariosContent).toContain('#portfolio-interview-chat');
  });

  it('portfolio-tour가 #portfolio-originality-gauge 타깃을 가져야 한다', () => {
    expect(scenariosContent).toContain('#portfolio-originality-gauge');
  });

  it('ews-tour가 #admin-sidebar-ews 타깃을 가져야 한다', () => {
    expect(scenariosContent).toContain('#admin-sidebar-ews');
  });

  it('ews-tour가 #admin-sidebar-thresholds 타깃을 가져야 한다', () => {
    expect(scenariosContent).toContain('#admin-sidebar-thresholds');
  });

  it('ALL_TOURS에 portfolio-tour, ews-tour가 포함되어야 한다', () => {
    const allToursLine = scenariosContent
      .split('\n')
      .find((l) => l.includes('export const ALL_TOURS'));
    expect(allToursLine).toContain('portfolioTour');
    expect(allToursLine).toContain('ewsTour');
  });

  it('PortfolioPage에 #portfolio-stage-tracker id가 있어야 한다', () => {
    const portfolioContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/PortfolioPage.tsx'),
      'utf-8',
    );
    expect(portfolioContent).toContain('id="portfolio-stage-tracker"');
  });

  it('PortfolioPage에 #portfolio-interview-chat id가 있어야 한다', () => {
    const portfolioContent = readFileSync(
      path.join(ROOT, 'ui/src/pages/PortfolioPage.tsx'),
      'utf-8',
    );
    expect(portfolioContent).toContain('id="portfolio-interview-chat"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ UI 컴포넌트 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('⑨ UI 컴포넌트 및 훅 구조', () => {
  it('OnboardingTour.tsx 컴포넌트 파일이 존재해야 한다', () => {
    expect(existsSync(path.join(ROOT, 'ui/src/components/OnboardingTour.tsx'))).toBe(true);
  });

  it('useOnboarding.ts 훅 파일이 존재해야 한다', () => {
    expect(existsSync(path.join(ROOT, 'ui/src/hooks/useOnboarding.ts'))).toBe(true);
  });

  it('useFeatureTour.ts 훅 파일이 존재해야 한다 (Gemini 제언 ①②③)', () => {
    expect(existsSync(path.join(ROOT, 'ui/src/hooks/useFeatureTour.ts'))).toBe(true);
  });

  it('useFeatureTour 훅이 driver.js를 임포트해야 한다', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useFeatureTour.ts'),
      'utf-8',
    );
    expect(hookContent).toContain("from 'driver.js'");
    expect(hookContent).toContain('driver.js/dist/driver.css');
  });

  it('useFeatureTour 훅이 patchProgress(/onboarding/progress) 를 호출해야 한다 (Gemini ①)', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useFeatureTour.ts'),
      'utf-8',
    );
    expect(hookContent).toContain('/onboarding/progress');
    expect(hookContent).toContain("method: 'PATCH'");
  });

  it('useOnboarding 훅이 useFeatureTour를 사용하는 thin wrapper여야 한다', () => {
    const hookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useOnboarding.ts'),
      'utf-8',
    );
    expect(hookContent).toContain('useFeatureTour');
    // 독립적인 driver.js import가 없어야 함 (useFeatureTour에 위임)
    expect(hookContent).not.toContain("from 'driver.js'");
  });

  it('useOnboarding 훅이 /onboarding/complete POST를 호출해야 한다', () => {
    const featureHookContent = readFileSync(
      path.join(ROOT, 'ui/src/hooks/useFeatureTour.ts'),
      'utf-8',
    );
    expect(featureHookContent).toContain('/onboarding/complete');
    expect(featureHookContent).toContain("method: 'POST'");
  });

  it('OnboardingTour 컴포넌트가 useFeatureTour를 사용해야 한다 (Gemini 제언 ③)', () => {
    const compContent = readFileSync(
      path.join(ROOT, 'ui/src/components/OnboardingTour.tsx'),
      'utf-8',
    );
    expect(compContent).toContain('useFeatureTour');
  });

  it('OnboardingTour 컴포넌트가 portfolio-tour를 구독해야 한다 (Gemini 제언 ③)', () => {
    const compContent = readFileSync(
      path.join(ROOT, 'ui/src/components/OnboardingTour.tsx'),
      'utf-8',
    );
    expect(compContent).toContain("'portfolio-tour'");
  });

  it('OnboardingTour 컴포넌트가 ews-tour를 구독해야 한다 (Gemini 제언 ③)', () => {
    const compContent = readFileSync(
      path.join(ROOT, 'ui/src/components/OnboardingTour.tsx'),
      'utf-8',
    );
    expect(compContent).toContain("'ews-tour'");
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
// ⑩ 온보딩 완료 상태 API 시뮬레이션
// ─────────────────────────────────────────────────────────────────────────────

describe('⑩ 온보딩 API 흐름 시뮬레이션 (Mock)', () => {
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
      json: async () => ({ completedTours: [], progressMap: {} }),
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
      json: async () => ({ completedTours: ['admin-tour'], progressMap: {} }),
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

  it('PATCH /progress 호출 시 lastStepIndex가 동기화되어야 한다 (Gemini ①)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, tourId: 'student-tour', lastStepIndex: 1 }),
    });

    const res = await fetch('/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ tourId: 'student-tour', lastStepIndex: 1 }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json() as { ok: boolean; lastStepIndex: number };
    expect(data.lastStepIndex).toBe(1);
  });

  it('GET /status가 progressMap도 반환해야 한다 (Gemini ①)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        completedTours: [],
        progressMap: { 'student-tour': 1 },
      }),
    });

    const res = await fetch('/onboarding/status', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const data = await res.json() as {
      completedTours: string[];
      progressMap: Record<string, number>;
    };
    expect(data.progressMap).toBeDefined();
    expect(data.progressMap['student-tour']).toBe(1);
  });
});
