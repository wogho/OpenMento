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
 *
 * Gemini 제언 ③: 도메인별 기능 투어 추가
 *   portfolio-tour: /portfolio 첫 방문 시 자동 실행
 *   ews-tour:       /admin 첫 방문 시 자동 실행 (admin 역할 전용)
 */

import type { DriveStep } from 'driver.js';

export type TourId = 'admin-tour' | 'student-tour' | 'portfolio-tour' | 'ews-tour';

export interface TourScenario {
  tourId: TourId;
  /** 대상 역할 ('teacher'과 'instructor'는 동일 역할의 영문/한국어 별칭) */
  roles: Array<'admin' | 'teacher' | 'instructor' | 'student'>;
  /** 투어 진입 경로 (투어를 시작할 페이지) */
  entryPath: string;
  steps: DriveStep[];
}

// ── 관리자 / 강사 투어 ─────────────────────────────────────────────────────────

export const adminTour: TourScenario = {
  tourId: 'admin-tour',
  roles: ['admin', 'teacher', 'instructor'],  // 'teacher' = 'instructor' 업무 역할 (양측 별칭 지원)
  entryPath: '/admin',
  steps: [
    {
      element: '#admin-sidebar-skills',
      popover: {
        title: '️ 스킬 파일 관리',
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
        title: ' 에이전트 설정',
        description:
          '에이전트를 과목에 연결하려면 이 탭에서 과목별 AI 강사를 등록하고 스킬 파일을 선택하세요. ' +
          'JSON 없이 드롭다운만으로 모든 설정이 가능합니다.',
        side: 'right',
        align: 'start',
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
        title: ' AI 튜터에게 질문하기',
        description:
          '궁금한 점을 자유롭게 입력하세요. AI 튜터가 교재를 바탕으로 소크라테스식 질문으로 사고를 안내합니다.',
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '#chat-messages',
      popover: {
        title: ' 교재 인용 링크',
        description:
          '답변에 포함된 교재 인용 링크를 클릭하면 원본 페이지를 직접 확인할 수 있습니다.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '#portfolio-nav-btn',
      popover: {
        title: ' 포트폴리오 기획서 작성',
        description:
          '수업이 어느 정도 진행되면 포트폴리오 기획서를 작성해보세요. ' +
          '다중 AI 에이전트가 인터뷰부터 독창성 검증까지 함께합니다.',
        side: 'bottom',
        align: 'center',
      },
    },
  ],
};

// ── 포트폴리오 기능 투어 (Gemini 제언 ③) ────────────────────────────────────────
// /portfolio 경로 최초 방문 시 자동 실행

export const portfolioTour: TourScenario = {
  tourId: 'portfolio-tour',
  roles: ['student'],
  entryPath: '/portfolio',
  steps: [
    {
      element: '#portfolio-stage-tracker',
      popover: {
        title: ' 4단계 포트폴리오 워크플로우',
        description:
          '인터뷰 → 기획서 작성 → 보안 검토 → 독창성 인증의 단계를 거칩니다. ' +
          '현재 단계가 강조되어 어디까지 진행됐는지 항상 확인할 수 있습니다.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '#portfolio-interview-chat',
      popover: {
        title: ' AI 페르소나 인터뷰',
        description:
          '다양한 산업군의 고객 역할을 맡은 AI 에이전트와 인터뷰합니다. ' +
          '실제 현업 요구사항 도출 과정을 시뮬레이션하여 기획서의 깊이를 높입니다.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '#portfolio-originality-gauge',
      popover: {
        title: ' 독창성 점수 실시간 확인',
        description:
          '기획서를 작성하면 역대 수료생 프로젝트와 유사도를 실시간으로 비교합니다. ' +
          '유사도 60% 미만이면 독창성 인증을 받을 수 있습니다.',
        side: 'left',
        align: 'center',
      },
    },
  ],
};

// ── EWS 기능 투어 (Gemini 제언 ③) ──────────────────────────────────────────────
// /admin 경로 최초 방문 시 admin 역할에게 자동 실행

export const ewsTour: TourScenario = {
  tourId: 'ews-tour',
  roles: ['admin', 'teacher'],
  entryPath: '/admin',
  steps: [
    {
      element: '#admin-sidebar-ews',
      popover: {
        title: ' EWS 위험 감지 대시보드',
        description:
          '출석률·과제 미제출·AI 튜터 활용률 등을 종합 분석해 중도탈락 위험 수강생을 ' +
          '자동으로 감지합니다. 위험 수강생 클릭 시 상담 예약 또는 안부 메시지를 발송할 수 있습니다.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '#admin-sidebar-thresholds',
      popover: {
        title: '️ EWS 임계치 조정',
        description:
          '위험 판정 기준(60점 / 75점 / 90점)을 슬라이더로 직접 조정하세요. ' +
          '강사가 "오탐"으로 표시한 피드백이 쌓일수록 임계치가 자동 보정됩니다.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '#admin-sidebar-schedule',
      popover: {
        title: '⏰ Heartbeat 스케줄 설정',
        description:
          '매시간·매일·매주 실행할 EWS 분석 주기를 코드 없이 드롭다운으로 설정합니다. ' +
          '변경 즉시 DB에 반영되며, 다음 주기부터 새 일정으로 자동 실행됩니다.',
        side: 'right',
        align: 'start',
      },
    },
  ],
};

export const ALL_TOURS: TourScenario[] = [adminTour, studentTour, portfolioTour, ewsTour];

/** 사용자 역할에 따라 실행할 투어 시나리오를 반환합니다. */
export function getTourForRole(role: string): TourScenario | undefined {
  return ALL_TOURS.find((t) => t.roles.includes(role as any));
}
