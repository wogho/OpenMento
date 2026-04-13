import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import * as Sentry from '@sentry/react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';

import { ThemeProvider } from './components/theme-provider';

// ── PostHog Analytics 셋업 (Phase 6-3) ──────────────────────────────
posthog.init(import.meta.env.VITE_POSTHOG_KEY || 'phc_mock_key_for_openmento', {
  api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
  loaded: (posthog) => {
    if (import.meta.env.DEV) posthog.debug();
  }
});

// ── Sentry APM 셋업 (Phase 6-2) ──────────────────────────────
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || 'https://public@sentry.example.com/2',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 네트워크 오류 시 최대 1회 자동 재시도 (LLM 응답 대기 등 고려)
      retry: 1,
      // 탭 포커스 시 자동 갱신 (관리자 대시보드 최신 상태 유지)
      refetchOnWindowFocus: true,
      // 5분 stale time — 상담 예약·점수 등 빈번히 변하지 않는 데이터
      staleTime: 5 * 60 * 1000,
    },
  },
});

// PWA Service Worker 등록
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // SW 등록 실패는 앱 동작에 영향 없음
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider defaultTheme="system" storageKey="openmento-ui-theme">
        <QueryClientProvider client={queryClient}>
          <PostHogProvider client={posthog}>
            <App />
          </PostHogProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
