/**
 * LLM 어댑터 팩토리 + Fallback 자동 전환 래퍼
 *
 * adapterConfig.provider 를 읽어 적절한 어댑터 인스턴스를 반환합니다.
 * fallbackAdapterConfig 가 있고 기본 어댑터 호출이 실패하면 자동으로 전환합니다.
 */

import type { AdapterConfig, ILlmAdapter } from './llm.interface.js';
import { OpenAiAdapter } from './openai.adapter.js';
import { AnthropicAdapter } from './anthropic.adapter.js';
import { GoogleAdapter } from './google.adapter.js';

export function createAdapter(config: AdapterConfig): ILlmAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAiAdapter(config);
    case 'anthropic':
      return new AnthropicAdapter(config);
    case 'google':
      return new GoogleAdapter(config);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`지원하지 않는 LLM 프로바이더: ${_exhaustive}`);
    }
  }
}

// ── Fallback 자동 전환 래퍼 ──────────────────────────────────────────────
// plan.md 1-2: fallbackAdapterConfig 필드 — LLM 장애 시 백업 벤더 자동 전환
export function createAdapterWithFallback(
  primary: AdapterConfig,
  fallback?: AdapterConfig | null,
): ILlmAdapter {
  const primaryAdapter = createAdapter(primary);

  if (!fallback) return primaryAdapter;

  const fallbackAdapter = createAdapter(fallback);

  // Proxy 패턴: primary 실패 시 fallback으로 재시도
  // 네트워크 오류(5xx) 또는 Rate Limit(429) 시에만 전환, 4xx 입력 오류는 즉시 throw
  return new Proxy(primaryAdapter, {
    get(target, prop) {
      if (prop !== 'chat' && prop !== 'chatStream') {
        return Reflect.get(target, prop);
      }

      return async (...args: unknown[]) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (target[prop as keyof ILlmAdapter] as any)(...args);
        } catch (err) {
          const isRetryable =
            err instanceof Error &&
            (err.message.includes('429') ||
              err.message.includes('500') ||
              err.message.includes('503') ||
              err.message.includes('ECONNRESET') ||
              err.message.includes('ETIMEDOUT'));

          if (!isRetryable) throw err;

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
