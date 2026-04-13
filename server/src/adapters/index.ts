/**
 * LLM 어댑터 팩토리 + Fallback 자동 전환 래퍼
 *
 * adapterConfig.provider 를 읽어 적절한 어댑터 인스턴스를 반환합니다.
 * fallbackAdapterConfig 가 있고 기본 어댑터 호출이 실패하면 자동으로 전환합니다.
 *
 * ── 서킷 브레이커 통합 (Phase 3 개선②) ─────────────────────────────────────
 *  primary 어댑터의 재시도 가능 오류(5xx/429/네트워크)가 연속 5회 발생하면
 *  서킷 브레이커가 OPEN 상태로 전환되어 5분 동안 primary 호출을 건너뜁니다.
 *  이후 요청은 즉시 fallback으로 라우팅되어 지연 없이 응답합니다.
 *  OPEN 전환 시 관리자에게 Slack 알림이 1회 발송됩니다.
 */

import type { AdapterConfig, ILlmAdapter } from './llm.interface.js';
import { OpenAiAdapter } from './openai.adapter.js';
import { AnthropicAdapter } from './anthropic.adapter.js';
import { GoogleAdapter } from './google.adapter.js';
import { GeminiCliAdapter } from './gemini-cli.adapter.js';
import { OpenClawAdapter } from './openclaw.adapter.js';
import { getCircuitBreaker } from '../services/circuit-breaker.js';
import { sendSystemAlert } from '../services/slack-notifier.js';

export function createAdapter(config: AdapterConfig): ILlmAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAiAdapter(config);
    case 'anthropic':
      return new AnthropicAdapter(config);
    case 'google':
      return new GoogleAdapter(config);
    case 'gemini_cli':
      return new GeminiCliAdapter(config);
    case 'openclaw':
      return new OpenClawAdapter(config);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`지원하지 않는 LLM 프로바이더: ${_exhaustive}`);
    }
  }
}

// ── Fallback 자동 전환 래퍼 ──────────────────────────────────────────────
// plan.md 1-2: fallbackAdapterConfig 필드 — LLM 장애 시 백업 벤더 자동 전환
// plan.md Phase 3 개선②: 서킷 브레이커 통합
export function createAdapterWithFallback(
  primary: AdapterConfig,
  fallback?: AdapterConfig | null,
): ILlmAdapter {
  const primaryAdapter = createAdapter(primary);

  if (!fallback) return primaryAdapter;

  const fallbackAdapter = createAdapter(fallback);
  const cbName = `${primary.provider}/${primary.model}`;

  // 서킷 브레이커 인스턴스 (모듈 레벨 레지스트리에서 재사용)
  const cb = getCircuitBreaker(cbName, {
    threshold: 5,
    resetMs: 5 * 60_000,
    onOpen: (name, count) => {
      console.warn(
        `[CircuitBreaker] 🔌 ${name} OPEN — ${count}회 연속 실패 후 5분간 차단`,
      );
      void sendSystemAlert(
        `🔌 *LLM 서킷 브레이커 작동* — \`${name}\` 차단됨\n` +
        `연속 *${count}회* 실패 후 5분간 백업 모델(\`${fallback.provider}/${fallback.model}\`)로 자동 전환됩니다.`,
      );
    },
  });

  // Proxy 패턴: primary 실패 시 fallback으로 재시도
  // 네트워크 오류(5xx) 또는 Rate Limit(429) 시에만 전환, 4xx 입력 오류는 즉시 throw
  return new Proxy(primaryAdapter, {
    get(target, prop) {
      if (prop !== 'chat' && prop !== 'chatStream') {
        return Reflect.get(target, prop);
      }

      return async (...args: unknown[]) => {
        // 서킷 OPEN 상태: primary 건너뜀 → 즉시 fallback (지연 제거)
        if (cb.isOpen()) {
          console.info(`[CircuitBreaker] ${cbName} OPEN — fallback으로 직행`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (fallbackAdapter[prop as keyof ILlmAdapter] as any)(...args);
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (target[prop as keyof ILlmAdapter] as any)(...args);
          cb.recordSuccess();
          return result;
        } catch (err) {
          const isRetryable =
            err instanceof Error &&
            (err.message.includes('429') ||
              err.message.includes('500') ||
              err.message.includes('503') ||
              err.message.includes('ECONNRESET') ||
              err.message.includes('ETIMEDOUT'));

          if (!isRetryable) throw err;

          cb.recordFailure();
          console.warn(
            `[LLM Fallback] ${primary.provider}/${primary.model} 실패 → ${fallback.provider}/${fallback.model} 전환`,
            err instanceof Error ? err.message : err,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (fallbackAdapter[prop as keyof ILlmAdapter] as any)(...args);
        }
      };
    },
  });
}

export type { ILlmAdapter, LlmMessage, LlmResponse, AdapterConfig, LlmStreamChunk } from './llm.interface.js';
