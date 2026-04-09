/**
 * Phase 5-3 — 역할별 온보딩 투어 시나리오 정의
 *
 * plan.md 5-3 시나리오:
 *   관리자/강사(admin):
 *     1단계: "첫 번째 스킬 파일을 만들어 보세요" → 예시 템플릿 자동 삽입
 *     2단계: "AI 강사를 현재 과목에 연결하세요" → 드롭다운으로 연결
 *     3단계: "수강생이 질문을 남기면 이렇게 보입니다" → 데모 미리보기
 *
 *   수강생(student):
 *     1단계: AI 튜터 입력창 안내
 *     2단계: 교재 인용 영역 안내
 *     3단계: 포트폴리오 기획서 이동 안내
 */

import type { DriveStep } from 'driver.js';

export type TourId = 'admin-tour' | 'student-tour';

export interface TourScenario {
  tourId: TourId;
  /** 대상 역할 */
  roles: Array<'admin' | 'instructor' | 'student'>;
  /** 투어 진입 경로 (투어를 시작할 페이지) */
  entryPath: string;
  steps: DriveStep[];
}

// ── 관리자 / 강사 투어 ─────────────────────────────────────────────────────────

export const adminTour: TourScenario = {
  tourId: 'admin-tour',
  roles: ['admin', 'instructor'],
  entryPath: '/admin',
  steps: [
    {
      element: '#admin-sidebar-skills',
      popover: {
        title: '✏️ 스킬 파일 관리',
        description:
          'AI 강사의 응답 방식을 정의하는 스킬 파일을 작성합니다. ' +
          '"예시 템플릿 삽입" 버튼으로 Java 스프링 또는 Python 기반 기본 양식을 즉시 불러올 수 있습니다.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '#admin-sidebar-agents',
      popover: {
        title: '🤖 에이전트 설정',
        description:
          '에이전트를 과목에 연결하려면 이 탭에서 과목별 AI 강사를 등록하고 스킬 파일을 선택하세요. ' +
          'JSON 없이 드롭다운만으로 모든 설정이 가능합니다.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '#admin-chat-preview-btn',
      popover: {
        title: '👀 수강생 뷰 미리보기',
        description:
          '이 버튼을 클릭하면 수강생이 보는 AI 튜터 채팅 화면으로 이동합니다. ' +
          '직접 질문을 입력해 대화 흐름을 확인해보세요.',
        side: 'top',
        align: 'center',
      },
    },
  ],
};

// ── 수강생 투어 ───────────────────────────────────────────────────────────────

export const studentTour: TourScenario = {
  tourId: 'student-tour',
  roles: ['student'],
  entryPath: '/chat',
  steps: [
    {
      element: '#chat-input',
      popover: {
        title: '💬 AI 튜터에게 질문하기',
        description:
          '궁금한 점을 자유롭게 입력하세요. AI 튜터가 교재를 바탕으로 소크라테스식 질문으로 사고를 안내합니다.',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '#chat-messages',
      popover: {
        title: '📚 교재 인용 링크',
        description:
          '답변에 포함된 교재 인용 링크를 클릭하면 원본 페이지를 직접 확인할 수 있습니다.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '#portfolio-nav-btn',
      popover: {
        title: '🎓 포트폴리오 기획서 작성',
        description:
          '수업이 어느 정도 진행되면 포트폴리오 기획서를 작성해보세요. ' +
          '다중 AI 에이전트가 인터뷰부터 독창성 검증까지 함께합니다.',
        side: 'bottom',
        align: 'center',
      },
    },
  ],
};

export const ALL_TOURS: TourScenario[] = [adminTour, studentTour];

/** 사용자 역할에 따라 실행할 투어 시나리오를 반환합니다. */
export function getTourForRole(role: 'admin' | 'instructor' | 'student'): TourScenario | undefined {
  return ALL_TOURS.find((t) => t.roles.includes(role));
}
