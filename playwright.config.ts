import { defineConfig, devices } from '@playwright/test';

/**
 * EduClip E2E Playwright 설정
 *
 * 로컬 개발: vite dev 서버 사용 (포트 4173 강제)
 * CI:        pnpm build 후 vite preview 사용
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // CI: build가 이미 완료된 상태에서 preview만 실행
    // 로컬: Vite dev 서버 직접 실행 (빌드 불필요)
    command: process.env.CI
      ? 'pnpm --filter @educlip/ui preview --port 4173'
      : 'pnpm --filter @educlip/ui dev --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
