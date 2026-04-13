/**
 * Socket.io WebSocket 목 헬퍼
 *
 * Playwright v1.43 기준 네이티브 WebSocket 라우팅이 없으므로
 * page.addInitScript() 로 WebSocket 생성자 자체를 교체한다.
 *
 * 교체된 MockWebSocket 은:
 *  1. 연결 즉시 EIO4 handshake → socket.io CONNECT 완료를 시뮬레이션한다.
 *  2. window.__mockWS 에 인스턴스를 노출하여 테스트 코드가 이벤트를 주입할 수 있게 한다.
 *  3. 클라이언트가 보내는 ping(2) 에 pong(3) 을 자동 응답한다.
 */

import type { Page } from '@playwright/test';

/** 페이지 로드 전 WebSocket 교체 스크립트를 삽입한다 */
export async function installSocketMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;

      constructor(_url: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__mockWS = this;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.(new Event('open'));

          // EIO4 OPEN 패킷
          this._receive(
            '0{"sid":"e2e-sid","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
          );
          // Socket.io CONNECT 확인 (default namespace)
          this._receive('40{"sid":"e2e-sid"}');
        }, 50);
      }

      send(data: string) {
        // EIO ping(2) → pong(3) 자동 응답
        if (data === '2') {
          setTimeout(() => this._receive('3'), 10);
        }
        // 전송 이력 보관 (assertions 용)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        w.__mockWSSent = w.__mockWSSent ?? [];
        w.__mockWSSent.push(data);
      }

      /** 테스트 코드에서 AI 이벤트를 주입할 때 사용 */
      _receive(data: string) {
        this.onmessage?.(new MessageEvent('message', { data }));
      }

      close() {
        this.readyState = 3;
      }

      // EventTarget 호환 stub
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const key = `on${type}` as keyof this;
        (this as unknown as Record<string, unknown>)[key as string] = listener;
      }
      removeEventListener() { /* no-op */ }
      dispatchEvent() { return false; }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = MockWebSocket;
  });
}

/**
 * 목 소켓을 통해 AI 응답 이벤트를 순차적으로 주입한다.
 *
 * @param page  Playwright Page 인스턴스
 * @param text  AI 응답으로 스트리밍할 전체 텍스트 (두 청크로 분할 전송)
 */
export async function injectAiResponse(page: Page, text: string): Promise<void> {
  const mid = Math.floor(text.length / 2);
  const chunk1 = text.slice(0, mid);
  const chunk2 = text.slice(mid);

  await page.evaluate(
    ([c1, c2]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = (window as any).__mockWS;
      if (!ws) return;

      ws._receive('42["typing_start"]');
      setTimeout(() => ws._receive(`42["chat_chunk",{"chunk":"${c1}"}]`), 30);
      setTimeout(() => ws._receive(`42["chat_chunk",{"chunk":"${c2}"}]`), 60);
      setTimeout(
        () =>
          ws._receive(
            '42["chat_done",{"sessionId":"sess-e2e-001","ragSourceCount":2,"model":"claude-haiku","inputTokens":50,"outputTokens":30}]',
          ),
        90,
      );
    },
    [chunk1, chunk2],
  );
}
