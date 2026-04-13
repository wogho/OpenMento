/**
 * instrument.ts — Sentry APM 선로드 초기화 파일
 *
 * ESM 환경에서 Sentry가 Express를 올바르게 계측하려면
 * `--import` 플래그로 애플리케이션 진입점보다 먼저 로드해야 합니다.
 *
 * 참고: https://docs.sentry.io/platforms/javascript/guides/express/install/esm/
 *
 * 기동 방법 (server/package.json dev 스크립트):
 *   tsx --import ./src/instrument.ts watch src/index.ts
 */
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN || 'https://public@sentry.example.com/1',
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
