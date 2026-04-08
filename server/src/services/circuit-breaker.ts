/**
 * circuit-breaker.ts — LLM 어댑터 서킷 브레이커
 *
 * plan.md Phase 3 개선②: LLM 서킷 브레이커 & 장애 전환 알림
 *
 * ── 문제 ────────────────────────────────────────────────────────────────────
 *  현재 Fallback Proxy는 primary 실패 시 즉시 fallback으로 전환합니다.
 *  그러나 primary가 완전히 다운된 경우 매 요청마다 타임아웃 대기 후 실패하여
 *  수강생 응답 지연(Latency)이 극심해집니다.
 *
 * ── 해결: 서킷 브레이커 패턴 ──────────────────────────────────────────────
 *  연속 실패가 threshold(기본 5회)를 넘으면 OPEN 상태로 전환합니다.
 *  OPEN 상태에서는 primary 호출을 생략하고 즉시 fallback을 호출합니다.
 *  resetMs(기본 5분) 후 HALF_OPEN으로 전환하여 한 번 프로브를 허용합니다.
 *
 * ── 상태 전이 ─────────────────────────────────────────────────────────────
 *
 *  CLOSED ──[threshold회 실패]──▶ OPEN ──[resetMs 경과]──▶ HALF_OPEN
 *    ▲                                                          │
 *    └────────────────[성공]────────────────────────────────────┘
 *                                    │
 *                                [실패]
 *                                    ▼
 *                                  OPEN (재차단)
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** 연속 실패 임계치 (기본: 5) */
  threshold?: number;
  /** OPEN 상태 유지 시간 ms (기본: 5분) */
  resetMs?: number;
  /** OPEN 전환 시 호출되는 콜백 (Slack 알림 등) */
  onOpen?: (name: string, failureCount: number) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    readonly name: string,
    private readonly threshold: number,
    private readonly resetMs: number,
    private readonly onOpen?: (name: string, failureCount: number) => void,
  ) {}

  /**
   * 서킷이 차단(OPEN) 상태인지 확인합니다.
   * OPEN이지만 resetMs가 경과했으면 HALF_OPEN으로 전환하며 false를 반환합니다.
   */
  isOpen(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - (this.openedAt ?? 0) >= this.resetMs) {
        this.state = 'HALF_OPEN';
        return false; // 프로브 한 번 허용
      }
      return true; // 쿨다운 중 — primary 건너뜀
    }
    return false;
  }

  /** 성공 시 호출 — CLOSED 상태로 복구 */
  recordSuccess(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = null;
  }

  /**
   * 재시도 가능 오류 발생 시 호출합니다.
   * 실패 횟수가 threshold를 초과하면 OPEN으로 전환 후 onOpen 콜백을 1회 실행합니다.
   */
  recordFailure(): void {
    this.failures++;
    const wasAlreadyOpen = this.state === 'OPEN';

    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();

      // CLOSED → OPEN 첫 전환 시에만 알림 콜백 실행
      if (!wasAlreadyOpen) {
        this.onOpen?.(this.name, this.failures);
      }
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /** @internal 테스트 전용: 인스턴스 상태 초기화 */
  _reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = null;
  }
}

// ── 모듈 레벨 레지스트리 ─────────────────────────────────────────────────────
// Node.js 단일 프로세스 내에서 어댑터 키별 CircuitBreaker 인스턴스를 재사용합니다.
// 키 형식: "provider/model" (예: "openai/gpt-4o-mini")

const registry = new Map<string, CircuitBreaker>();

/**
 * 이름으로 CircuitBreaker 인스턴스를 조회하거나 신규 생성합니다.
 * 동일 이름은 항상 동일 인스턴스를 반환합니다.
 */
export function getCircuitBreaker(
  name: string,
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  if (!registry.has(name)) {
    const cb = new CircuitBreaker(
      name,
      options.threshold ?? 5,
      options.resetMs ?? 5 * 60_000,
      options.onOpen,
    );
    registry.set(name, cb);
  }
  return registry.get(name)!;
}

/** @internal 테스트 전용: 레지스트리 전체 초기화 */
export function _resetCircuitBreakerRegistry(): void {
  registry.clear();
}
