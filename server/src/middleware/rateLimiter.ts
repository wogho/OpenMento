/**
 * rateLimiter.ts — Express Rate Limiting 미들웨어
 *
 * plan.md 부록 B: DDoS 방어 및 AI API 비용 고갈 방지.
 * express-rate-limit 을 사용하여 라우트별 요청 빈도를 제한합니다.
 *
 * 각 limiter 는 라우터 레벨에서 개별 적용합니다 (전역 적용 X).
 * 이유: /health, /admin/documents(대용량 업로드) 등은 다른 정책이 필요합니다.
 *
 * 메모리 스토어(기본값) 사용 — 단일 인스턴스 기준.
 * 멀티 인스턴스(Phase 5)에서는 ioredis + rate-limit-redis 스토어로 교체하십시오.
 */

import rateLimit from 'express-rate-limit';

/** 인증 라우트 (/auth/login, /auth/refresh) — 브루트포스 방어 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15분
  max: 20,                     // 15분당 최대 20회 (IP 기준)
  standardHeaders: 'draft-7', // RateLimit-* 헤더 포함 (RFC 표준 초안)
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
  skipSuccessfulRequests: false,
});

/** 채팅(LLM 스트리밍) 라우트 — AI 토큰 비용 고갈 방어 */
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1분
  max: 30,                     // 분당 최대 30회 (수강생 1인)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'AI 채팅 요청이 너무 많습니다. 1분 후 다시 시도해 주세요.' },
});

/** 어드민 일반 API — 어드민 계정 탈취 후 대량 데이터 추출 방어 */
export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1분
  max: 120,                    // 분당 최대 120회 (관리자 다중 탭 허용)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '관리자 API 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
});

/** EWS Slack 테스트 발송 — 비용 유발 외부 요청 방어 */
export const slackTestLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1분
  max: 5,                      // 분당 최대 5회
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Slack 테스트 호출이 너무 많습니다. 1분 후 다시 시도해 주세요.' },
});

/**
 * GitHub Webhook 수신 — Push/PR 이벤트 대량 반복 방어
 * GitHub 은 일반적으로 분당 수 회 이내로 전송하므로 넉넉하게 설정
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1분
  max: 60,                     // 분당 최대 60회 (레포 수 × 이벤트 빈도 고려)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Webhook 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
  // 서명 검증 실패(401)된 요청도 카운트에 포함하여 공격 억제
  skipSuccessfulRequests: false,
});
