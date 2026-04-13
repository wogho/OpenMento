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
  provider: 'openai' | 'anthropic' | 'google' | 'gemini_cli' | 'openclaw';
  model: string;
  temperature?: number;        // 기본값: 0.7
  maxTokens?: number;          // 기본값: 2048
  /** LLM API 요청 하드 타임아웃 (ms). 기본값: 30_000 (30초) */
  timeoutMs?: number;
  /**
   * 런타임 주입 API 키.
   * DB secrets에서 resolv한 값을 직접 전달합니다.
   * 제공 시 process.env 환경변수보다 우선 적용됩니다.
   */
  apiKey?: string;

  // ── HTTP Webhook 어댑터 (paperclip http adapter 참조) ─────────────────
  /**
   * 어댑터 타입 구분.
   * llm_api  : LLM API 직접 호출 (기본값)
   * http_webhook : 외부 웹훅 엔드포인트로 실행 위임
   */
  adapterType?: 'llm_api' | 'http_webhook';

  /** Webhook POST 대상 URL (외부 에이전트 엔드포인트) */
  webhookUrl?: string;

  /**
   * 추가 요청 헤더 맵.
   * 값에 ${secrets.openaiApiKey} 등 ${secrets.NAME} 패턴 사용 가능
   * (실행 시 기관 secrets에서 치환됩니다).
   */
  webhookHeaders?: Record<string, string>;

  /**
   * 컨텍스트 전달 방식 (paperclip contextMode 참조).
   * thin : runId·agentId 등 포인터만 전송 (기본, 대역폭 절약)
   * fat  : contextSnapshot 전체 JSON 포함 전송 (외부 에이전트가 full context 필요 시)
   */
  contextMode?: 'thin' | 'fat';

  /**
   * 프롬프트 템플릿 (Mustache 스타일 {{variable}} 치환).
   * 지원 변수: {{agent.name}}, {{agent.id}}, {{agent.role}},
   *            {{runId}}, {{institutionId}}, {{invocationSource}}
   */
  promptTemplate?: string;
}

// ── Session Codec (paperclip AdapterSessionCodec 참조) ────────────────────
/**
 * 어댑터 세션 직렬화/역직렬화 코덱.
 * 외부 에이전트(http_webhook)는 실행 완료 후 sessionParams를 callback에 포함해
 * 다음 실행 시 재개할 수 있습니다. 코덱은 직렬화·역직렬화·displayId 파생을 담당합니다.
 *
 * paperclip의 AdapterSessionCodec 인터페이스와 동일한 계약:
 *   serialize: 실행 전 저장 시 호출 (null → 세션 없음)
 *   deserialize: 실행 전 복원 시 호출 (null → 세션 없음)
 *   getDisplayId: 사람이 읽을 수 있는 식별자 파생 (예: thread_id, session_key)
 */
export interface AdapterSessionCodec {
  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null;
  deserialize(raw: unknown): Record<string, unknown> | null;
  getDisplayId(params: Record<string, unknown> | null): string | null;
}

/**
 * 어댑터 직접 실행 결과 (http_webhook이 동기적으로 반환하거나
 * callback payload에서 파싱된 값).
 * paperclip AdapterExecutionResult 패턴 참조.
 */
export interface AdapterSessionResult {
  /** 어댑터가 반환한 새 세션 파라미터 (null = 변경 없음) */
  sessionParams?: Record<string, unknown> | null;
  /** 어댑터가 반환한 세션 ID 문자열 (getDisplayId 대신 명시적 반환 시) */
  sessionId?: string | null;
  /** true면 현재 세션을 삭제 (대화 스레드 초기화 등) */
  clearSession?: boolean;
  /** 어댑터가 반환한 머신-읽기용 에러 코드 (예: 'rate_limited') */
  errorCode?: string | null;
}

// ── HTTP Webhook 에이전트 실행 컨텍스트 (paperclip AdapterExecutionContext 참조) ──
/**
 * executeAgentViaHttpWebhook() 호출 시 전달되는 실행 컨텍스트.
 * heartbeat.ts 내부에서 생성되며 외부 webhook payload 에도 포함됩니다.
 */
export interface AgentExecutionContext {
  runId: string;
  agentId: string;
  institutionId: string;
  invocationSource: 'timer' | 'on_demand' | 'wakeup' | 'automation';
  authToken: string;
  /** fat 모드일 때만 포함되는 전체 컨텍스트 스냅샷 */
  contextSnapshot?: Record<string, unknown>;
  /**
   * 이전 실행에서 직렬화된 세션 파라미터.
   * null = 최초 실행 또는 세션 없음.
   * 외부 에이전트는 이를 사용해 스레드·컨텍스트를 재개합니다.
   */
  sessionParams?: Record<string, unknown> | null;
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
