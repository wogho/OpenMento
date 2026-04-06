/**
 * LLM 어댑터 공통 인터페이스 (plan.md 1-2 참조)
 *
 * OpenAI / Anthropic / Google Gemini 중 어느 프로바이더든
 * 동일한 인터페이스로 교체 가능하도록 추상화합니다.
 * adapterConfig JSON에서 provider 필드를 읽어 팩토리가 적절한 구현체를 반환합니다.
 */

// ── 공통 메시지 타입 ──────────────────────────────────────────────────────
export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

// ── 어댑터 설정 ───────────────────────────────────────────────────────────
export interface AdapterConfig {
  provider: 'openai' | 'anthropic';
  model: string;
  temperature?: number;        // 기본값: 0.7
  maxTokens?: number;          // 기본값: 2048
  /** LLM API 요청 하드 타임아웃 (ms). 기본값: 30_000 (30초) */
  timeoutMs?: number;
}

// ── 응답 타입 ─────────────────────────────────────────────────────────────
export interface LlmResponse {
  content: string;             // 최종 텍스트 응답
  model: string;               // 실제 사용 모델명 (fallback 추적용)
  inputTokens: number;
  outputTokens: number;
}

// ── 스트리밍 응답 타입 (Phase 1-4 WebSocket 용) ───────────────────────────
export type LlmStreamChunk = { delta: string; done: false } | { delta: ''; done: true };

// ── 어댑터 인터페이스 ─────────────────────────────────────────────────────
export interface ILlmAdapter {
  readonly provider: string;
  readonly model: string;

  /**
   * 단일 요청/응답 (REST API용)
   * messages 배열의 첫 system 메시지는 System Prompt로 분리됩니다.
   */
  chat(messages: LlmMessage[]): Promise<LlmResponse>;

  /**
   * 스트리밍 응답 (WebSocket용 — Phase 1-4에서 완성)
   * onChunk 콜백으로 delta 텍스트를 실시간 전달합니다.
   */
  chatStream(messages: LlmMessage[], onChunk: (chunk: LlmStreamChunk) => void): Promise<LlmResponse>;
}
