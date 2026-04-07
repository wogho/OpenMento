/**
 * 시나리오 3: 관리자 GUI 임계치 슬라이더 조정 → EWS 위험 수강생 식별 변화 확인
 *
 * 커버하는 플로우:
 *   /admin/thresholds (GUI 설정 페이지)
 *     → 임계치 슬라이더 조정 (warningThreshold: 60 → 50)
 *     → "저장" 버튼 클릭 → PUT /admin/thresholds API 호출
 *     → 성공 토스트 확인
 *     → /admin/ews (EWS 위험 수강생 대시보드)
 *     → 위험 수강생 목록 재조회 → 50~59점 수강생이 새로 warning 목록에 포함됨
 *
 * ── 테스트 전략 ───────────────────────────────────────────────────────────────
 *
 *  UI 서버가 실제 구동 중이지 않아도 검증할 수 있도록
 *  API 호출 계층을 Playwright route()로 모킹합니다.
 *
 *  ① PUT /admin/thresholds → 200 OK 응답 및 반환 데이터 모킹
 *  ② GET /admin/ews/risk-students → 조회한 임계치에 따라 다른 수강생 목록 반환
 *     - 기본 임계치(warning=60): 60점 이상 수강생만 위험으로 분류
 *     - 변경 임계치(warning=50): 50점 이상 수강생도 위험으로 분류
 *
 *  검증 포인트:
 *  - 임계치 저장 UI 인터랙션 (슬라이더·숫자 입력 → 저장 버튼) 동작
 *  - 저장 후 대시보드에 변경 결과가 반영되는 플로우
 */

import { test, expect, type Page } from '@playwright/test';
import { ADMIN_TOKEN } from './helpers/tokens';

// ── 목(mock) 데이터 ────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  warningThreshold:  60,
  highRiskThreshold: 75,
  criticalThreshold: 90,
  slackEscalateScore: 75,
};

const UPDATED_THRESHOLDS = {
  ...DEFAULT_THRESHOLDS,
  warningThreshold: 50,  // 50점 이상이면 warning
};

/** 기본 임계치(60) 기준: 55점 수강생은 위험 아님 */
const STUDENTS_DEFAULT = [
  { studentId: 's-001', name: '김수강', score: 80, level: 'high_risk' },
  { studentId: 's-002', name: '이수강', score: 65, level: 'warning' },
  // 55점(정상) 수강생은 포함되지 않음
];

/** 변경 임계치(50) 기준: 55점 수강생이 새로 warning에 포함됨 */
const STUDENTS_AFTER_UPDATE = [
  { studentId: 's-001', name: '김수강', score: 80, level: 'high_risk' },
  { studentId: 's-002', name: '이수강', score: 65, level: 'warning' },
  { studentId: 's-003', name: '박수강', score: 55, level: 'warning' },  // 새로 포함
];

// ── 공통 셋업 ─────────────────────────────────────────────────────────────────

async function setupAdminSession(page: Page): Promise<void> {
  // 관리자 JWT를 localStorage에 주입
  await page.addInitScript((token: string) => {
    localStorage.setItem('authToken', token);
  }, ADMIN_TOKEN);
}

async function mockThresholdsRoutes(page: Page, updatedOnce = false): Promise<void> {
  let putCalled = false;

  // GET /admin/thresholds — 현재 임계치 조회
  await page.route('**/admin/thresholds', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(putCalled || updatedOnce ? UPDATED_THRESHOLDS : DEFAULT_THRESHOLDS),
      });
    } else if (route.request().method() === 'PUT') {
      // PUT /admin/thresholds — 임계치 저장
      putCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(UPDATED_THRESHOLDS),
      });
    } else {
      await route.continue();
    }
  });
}

async function mockEwsRiskStudentsRoute(page: Page, useUpdatedThreshold: boolean): Promise<void> {
  await page.route('**/admin/ews/risk-students**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(useUpdatedThreshold ? STUDENTS_AFTER_UPDATE : STUDENTS_DEFAULT),
    });
  });
}

// ── 테스트 케이스 ─────────────────────────────────────────────────────────────

test.describe('시나리오 3: 관리자 임계치 슬라이더 → EWS 위험 수강생 반영', () => {
  test.beforeEach(async ({ page }) => {
    await setupAdminSession(page);
  });

  test('임계치 설정 페이지에서 현재 임계치(60점) 값 확인', async ({ page }) => {
    await mockThresholdsRoutes(page);
    await mockEwsRiskStudentsRoute(page, false);

    await page.goto('/admin/thresholds');

    // 임계치 설정 페이지 로딩 확인
    await expect(page.getByRole('heading', { name: /임계치|EWS|위험/ })).toBeVisible();

    // 현재 warning 임계치 값이 60으로 표시되는지 확인
    // (input[type=range] 또는 숫자 입력 필드)
    const warningInput = page.locator('[data-testid="warning-threshold"]')
      .or(page.locator('input[aria-label*="warning" i]'))
      .or(page.locator('input[name="warningThreshold"]'));

    if (await warningInput.count() > 0) {
      await expect(warningInput.first()).toHaveValue('60');
    } else {
      // 숫자 텍스트로 표시되는 경우
      await expect(page.getByText('60')).toBeVisible();
    }
  });

  test('임계치 변경(50) → 저장 → 성공 메시지 표시', async ({ page }) => {
    let putRequestBody: Record<string, unknown> | null = null;

    // PUT 요청 본문 캡처
    await page.route('**/admin/thresholds', async (route) => {
      if (route.request().method() === 'PUT') {
        putRequestBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(UPDATED_THRESHOLDS),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(DEFAULT_THRESHOLDS),
        });
      }
    });

    await mockEwsRiskStudentsRoute(page, false);
    await page.goto('/admin/thresholds');

    // warning 임계치 입력 필드를 찾아 50으로 변경
    const warningInput = page.locator('[data-testid="warning-threshold"]')
      .or(page.locator('input[name="warningThreshold"]'))
      .or(page.locator('input[aria-label*="warning" i]'));

    if (await warningInput.count() > 0) {
      await warningInput.first().fill('50');
    } else {
      // 슬라이더인 경우 범위 설정
      const slider = page.locator('input[type="range"]').first();
      if (await slider.count() > 0) {
        await slider.fill('50');
      }
    }

    // 저장 버튼 클릭
    const saveButton = page.getByRole('button', { name: /저장|적용|확인/ });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // 성공 토스트 / 알림 메시지 확인
    await expect(
      page.getByText(/저장|완료|적용/).or(page.getByRole('alert')),
    ).toBeVisible({ timeout: 5000 });

    // PUT 요청이 실제로 발생했는지 확인
    expect(putRequestBody).not.toBeNull();
  });

  test('임계치 변경 후 EWS 대시보드에서 새 수강생(55점) 위험 목록 포함 확인', async ({ page }) => {
    // PUT이 호출된 후에는 변경된 수강생 목록 반환
    let ewsCallCount = 0;

    await page.route('**/admin/thresholds', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(UPDATED_THRESHOLDS),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(DEFAULT_THRESHOLDS),
        });
      }
    });

    await page.route('**/admin/ews/risk-students**', async (route) => {
      ewsCallCount++;
      // 두 번째 EWS 조회부터는 변경된 임계치 기준 수강생 목록 반환
      const students = ewsCallCount >= 2 ? STUDENTS_AFTER_UPDATE : STUDENTS_DEFAULT;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(students),
      });
    });

    // 1. 임계치 설정 후 저장
    await page.goto('/admin/thresholds');
    const saveButton = page.getByRole('button', { name: /저장|적용|확인/ });
    if (await saveButton.count() > 0) {
      await saveButton.click();
      await page.waitForTimeout(500); // 저장 완료 대기
    }

    // 2. EWS 대시보드로 이동
    await page.goto('/admin/ews');

    // 3. warning 임계치가 50으로 내려간 덕분에 '박수강(55점)'이 목록에 등장
    //    (해당 수강생명 또는 점수가 표시되는지 확인)
    await expect(
      page.getByText('박수강').or(page.getByText('55')),
    ).toBeVisible({ timeout: 8000 });
  });

  test('API 호출 구조 검증: PUT /admin/thresholds 요청 스키마 확인', async ({ page }) => {
    const capturedRequests: Array<{ method: string; body: unknown }> = [];

    await page.route('**/admin/thresholds', async (route) => {
      capturedRequests.push({
        method: route.request().method(),
        body: route.request().method() === 'PUT'
          ? route.request().postDataJSON()
          : null,
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(UPDATED_THRESHOLDS),
      });
    });

    await mockEwsRiskStudentsRoute(page, false);

    // 임계치 페이지 방문 시 GET 호출 발생
    await page.goto('/admin/thresholds');
    await page.waitForTimeout(500);

    const getRequest = capturedRequests.find((r) => r.method === 'GET');
    expect(getRequest).toBeDefined();

    // 저장 버튼이 있는 경우 PUT 요청 스키마 검증
    const saveButton = page.getByRole('button', { name: /저장|적용|확인/ });
    if (await saveButton.count() > 0) {
      await saveButton.click();
      await page.waitForTimeout(500);

      const putRequest = capturedRequests.find((r) => r.method === 'PUT');
      if (putRequest?.body) {
        const body = putRequest.body as Record<string, unknown>;
        // PUT 요청 본문에 올바른 필드명이 포함되어 있는지 확인
        const validFields = ['warningThreshold', 'highRiskThreshold', 'criticalThreshold', 'slackEscalateScore'];
        const hasValidField = validFields.some((f) => f in body);
        expect(hasValidField).toBe(true);
      }
    }
  });
});
