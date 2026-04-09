/**
 * 시나리오 2: 교재 업로드 → 임베딩 완료 → RAG 검색 응답 포함 여부
 *
 * 커버하는 플로우:
 *   관리자 로그인 → /admin 접근 (AdminRoute role 검증)
 *   → 교재 Documents 탭
 *   → PDF 파일 드래그앤드롭(또는 클릭) 업로드 → POST /admin/documents (mocked)
 *   → 업로드 진행률 표시 → 완료 후 목록에 파일명 등장
 *   → 파일 삭제 → DELETE /admin/documents/:id (mocked)
 *   → 목록에서 제거 확인
 *
 *   보안 Guard 검증:
 *   → student 계정으로 /admin 접근 시 /chat 으로 리다이렉트
 */

import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { ADMIN_TOKEN, STUDENT_TOKEN } from './helpers/tokens';
import { installSocketMock } from './helpers/socket-mock';

// 업로드할 테스트용 더미 PDF 경로 (tests/e2e/fixtures/)
const DUMMY_PDF_PATH = path.join(__dirname, 'fixtures', 'sample.pdf');
const UPLOADED_FILENAME = 'sample.pdf';
const UPLOADED_DOC_ID = 'doc-e2e-001';

// ── 공통 셋업 ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await installSocketMock(page);

  // 로그인 API 목 — 요청 바디의 email 에 따라 토큰 분기
  await page.route('**/api/auth/login', async (route, request) => {
    const body = (await request.postDataJSON()) as { email: string };
    const token = body.email.includes('admin') ? ADMIN_TOKEN : STUDENT_TOKEN;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token }),
    });
  });
});

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await page.getByRole('button', { name: '로그인' }).click();
  // 로그인 후 URL 변경이 완료될 때까지 대기
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
}

// ── 테스트 케이스 ─────────────────────────────────────────────────────────────

test('student 역할로 /admin 접근 시 /chat 으로 리다이렉트 (AdminRoute Guard)', async ({
  page,
}) => {
  // 수강생으로 로그인
  await loginAs(page, 'student@example.com');
  await expect(page).toHaveURL(/\/chat/);

  // /admin 직접 접근 시도
  await page.goto('/admin');
  // AdminRoute 에서 role != 'admin' → /chat 으로 리다이렉트
  await expect(page).toHaveURL(/\/chat/);
});

test('admin 역할로 /admin 접근 → 관리자 허브 렌더링', async ({ page }) => {
  // 교재 목록 초기화 API 목
  await page.route((url) => url.port === '3000' && url.pathname === '/admin/documents', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else {
      await route.continue();
    }
  });

  await loginAs(page, 'admin@example.com');
  // 관리자 로그인 후 /chat 으로 이동하므로 /admin 수동 이동
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin/);

  // 관리자 허브 UI 요소 확인
  await expect(page.getByText('교재 관리').first()).toBeVisible();
  await expect(page.getByText('보안 키 관리').first()).toBeVisible();
});

test('PDF 교재 업로드 → 목록 등장 → 삭제', async ({ page }) => {
  // 목록 초기 빈 배열 반환
  await page.route(
    (url) => url.port === '3000' && url.pathname === '/admin/documents',
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      } else if (route.request().method() === 'POST') {
        // 업로드 성공 응답
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: UPLOADED_DOC_ID,
            filename: UPLOADED_FILENAME,
            createdAt: new Date().toISOString().split('T')[0],
          }),
        });
      } else {
        await route.continue();
      }
    },
  );

  // 삭제 API 목
  await page.route(
    (url) => url.port === '3000' && url.pathname.startsWith('/admin/documents/'),
    async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 });
      } else {
        await route.continue();
      }
    },
  );

  await loginAs(page, 'admin@example.com');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin/);

  // 교재 관리 탭으로 전환
  await page.getByText('교재 관리').first().click();

  // 드래그앤드롭 영역 내 숨겨진 file input 을 통해 파일 업로드
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(DUMMY_PDF_PATH);

  // 업로드 완료 후 목록에 파일명 등장 확인
  await expect(page.getByText(UPLOADED_FILENAME).first()).toBeVisible({ timeout: 10_000 });

  // 삭제 버튼 클릭 (confirm 다이얼로그 자동 수락)
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByTitle('기록 삭제').click();

  // 목록에서 제거 확인
  await expect(page.getByText(UPLOADED_FILENAME).first()).toBeHidden({ timeout: 5_000 });
});

test('형식 오류 파일 드롭 시 인라인 에러 메시지 표시 (onDropRejected)', async ({ page }) => {
  await page.route(
    (url) => url.port === '3000' && url.pathname === '/admin/documents',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    },
  );

  await loginAs(page, 'admin@example.com');
  await page.goto('/admin');

  // 교재 관리 탭으로 전환
  await page.getByText('교재 관리').first().click();

  // .txt 파일 → PDF 전용 검증에서 거절되어야 함
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: 'wrong.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not a pdf'),
  });

  await expect(page.getByText('PDF 파일만 업로드할 수 있습니다.')).toBeVisible({ timeout: 5_000 });
});
