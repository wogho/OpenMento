/**
 * AI 튜터 채팅 전역 상태 (Zustand)
 *
 * 단일 스토어에서 메시지, 타이핑 상태, 소켓 연결 상태, 세션 ID를 관리한다.
 * Phase 4(포트폴리오 다중 에이전트) 확장을 대비하여 슬라이스 분리가 쉬운 구조로 설계.
 *
 * 컴포넌트에서는 구독 단위를 최소화해서 불필요한 리렌더링을 방지한다.
 *   const messages = useChatStore((s) => s.messages);        // OK
 *   const store = useChatStore();                            // 전체 구독 → 비권장
 */

import { create } from 'zustand';

// ── 공개 타입 (useChat.ts와 공유) ─────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface RagSource {
  documentId: string;
  title: string;
  page?: number;
  /** 관리자 업로드 시 base URL + page 조합 */
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 교재 인용 소스 (RAG) */
  sources?: RagSource[];
  createdAt: Date;
}

// ── 스토어 내부 타입 ──────────────────────────────────────────────────────────

interface ChatState {
  // ── 상태 ──
  messages: ChatMessage[];
  isTyping: boolean;
  error: string | null;
  sessionId: string | null;
  connectionStatus: ConnectionStatus;

  // ── 액션 ──
  addMessage: (msg: ChatMessage) => void;
  updateStreamingMessage: (id: string, chunk: string) => void;
  removeEmptyMessages: () => void;
  setIsTyping: (v: boolean) => void;
  setError: (e: string | null) => void;
  setSessionId: (id: string | null) => void;
  setConnectionStatus: (s: ConnectionStatus) => void;
  clearSession: () => void;
}

const SESSION_KEY = 'openmento_chat_session';

export const useChatStore = create<ChatState>((set) => ({
  // ── 초기 상태 ──
  messages: [],
  isTyping: false,
  error: null,
  sessionId: sessionStorage.getItem(SESSION_KEY),
  connectionStatus: 'connected',

  // ── 메시지 액션 ──
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  updateStreamingMessage: (id, chunk) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m,
      ),
    })),

  removeEmptyMessages: () =>
    set((s) => ({ messages: s.messages.filter((m) => m.content !== '') })),

  // ── 상태 세터 ──
  setIsTyping: (v) => set({ isTyping: v }),

  setError: (e) => set({ error: e }),

  setSessionId: (id) => {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
    set({ sessionId: id });
  },

  setConnectionStatus: (s) => set({ connectionStatus: s }),

  clearSession: () => {
    sessionStorage.removeItem(SESSION_KEY);
    set({ messages: [], sessionId: null, error: null });
  },
}));
