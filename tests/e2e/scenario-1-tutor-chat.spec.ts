/**
 * 시나리오 1: 수강생 로그인 → AI 튜터 질문 → 소크라테스식 답변 수신
 *
 * 커버하는 플로우:
 *   /login  → 이메일·비밀번호 입력 → POST /api/auth/login (mocked)
 *           → 리다이렉트 /chat
 *           → 빈 대화 초기 화면 검증
 *           → 질문 입력 + Enter 전송
 *           → 사용자 메시지 말풍선 등장
 *           → 타이핑 인디케이터 등장 (socket typing_start)
 *           → AI 스트리밍 답변 수신 + 완료 (chat_chunk / chat_done)
 */

import { test, expect } from '@playwright/test';
import { STUDENT_TOKEN } from './helpers/tokens';
import { installSocketMock, injectAiResponse } from './helpers/socket-mock';

const TEST_QUESTION = 'Java에서 클래스와 객체의 차이가 무엇인가요?';
const MOCK_AI_ANSWER = '클래스는 설계도이고 객체는 그 설계도로 만든 실체입니다. 교재 3페이지를 참고해 보세요.';

// ── 공통 셋업 ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  // 1. WebSocket(Socket.io) 목 설치 — 페이지 스크립트 실행 전에 삽입
  await installSocketMock(page);

  // 2. 로그인 API 목
  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: STUDENT_TOKEN }),
    });
  });

  // 3. 세션 메시지 이력 조회 API 목 (초기 빈 배열)
  await page.route('**/student/sessions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
});

// ── 테스트 케이스 ─────────────────────────────────────────────────────────────

test('로그인 폼 유효성 검사 — 이메일 형식 오류 시 에러 메시지 표시', async ({ page }) => {
  await page.goto('/login');

  // 잘못된 이메일 형식 입력
  await page.fill('#email', 'not-an-email');
  await page.fill('#password', '123456');
  await page.getByRole('button', { name: '로그인' }).click();

  await expect(page.getByText('올바른 이메일 형식이 아닙니다.')).toBeVisible();
});

test('로그인 성공 → /chat 리다이렉트 → 빈 대화 초기 화면', async ({ page }) => {
  await page.goto('/login');

  // 이메일 + 비밀번호 입력
  await page.fill('#email', 'student@example.com');
  await page.fill('#password', 'password123');
  await page.getByRole('button', { name: '로그인' }).click();

  // 채팅 페이지로 이동 확인
  await expect(page).toHaveURL(/\/chat/);

  // 빈 대화 초기 상태 문구 노출 확인
  await expect(page.getByText('무엇이 궁금한가요?')).toBeVisible();

  // 입력창 플레이스홀더 확인
  await expect(
    page.getByPlaceholder('질문을 입력하세요 (Enter로 전송)'),
  ).toBeVisible();
});

test('인증 없이 /chat 접근 → /login 리다이렉트', async ({ page }) => {
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login/);
});

test('질문 전송 → 사용자 메시지 말풍선 등장 → AI 스트리밍 답변 수신', async ({ page }) => {
  await page.goto('/login');

  // 로그인
  await page.fill('#email', 'student@example.com');
  await page.fill('#password', 'password123');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/chat/);

  // 질문 입력 및 Enter 전송
  const textarea = page.getByPlaceholder('질문을 입력하세요 (Enter로 전송)');
  await textarea.fill(TEST_QUESTION);
  await textarea.press('Enter');

  // 사용자 메시지 말풍선이 즉시 등장 (store.addMessage 동기 처리)
  await expect(page.getByText(TEST_QUESTION)).toBeVisible();

  // AI 응답 이벤트 주입 (typing_start → chat_chunk × 2 → chat_done)
  await injectAiResponse(page, MOCK_AI_ANSWER);

  // 타이핑 인디케이터 ("AI가 답변 중...") 이 등장했다가 사라짐
  // — chat_done 이후에는 사라지므로 AI 말풍선 텍스트를 기준으로 확인
  await expect(page.getByText(MOCK_AI_ANSWER)).toBeVisible({ timeout: 5_000 });
});

test('빈 입력으로 전송 시 메시지 추가 없음', async ({ page }) => {
  await page.goto('/login');

  await page.fill('#email', 'student@example.com');
  await page.fill('#password', 'password123');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/chat/);

  // 아무것도 입력하지 않고 Enter
  const textarea = page.getByPlaceholder('질문을 입력하세요 (Enter로 전송)');
  await textarea.press('Enter');

  // 메시지 말풍선이 생기지 않아야 함 (빈 대화 안내 유지)
  await expect(page.getByText('무엇이 궁금한가요?')).toBeVisible();
});
