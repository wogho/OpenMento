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

// ── localStorage 헬퍼 ─────────────────────────────────────────────────────────

const MESSAGES_PREFIX = 'openmento_chat_messages_';

/** studentId 포함 복합 키 — 동일 기기에서 서로 다른 수강생의 채팅 기록 분리 */
function msgKey(studentId: string, courseId: string): string {
  return `${MESSAGES_PREFIX}${studentId}_${courseId}`;
}

function loadMessages(studentId: string, courseId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(msgKey(studentId, courseId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<ChatMessage & { createdAt: string }>;
    return parsed.map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
  } catch {
    return [];
  }
}

function saveMessages(studentId: string, courseId: string, messages: ChatMessage[]): void {
  try {
    // 최대 200개만 저장
    const slice = messages.slice(-200);
    localStorage.setItem(msgKey(studentId, courseId), JSON.stringify(slice));
  } catch {
    // localStorage 용량 초과 시 무시
  }
}

function removeMessages(studentId: string, courseId: string): void {
  localStorage.removeItem(msgKey(studentId, courseId));
}

// ── 공개 타입 (useChat.ts와 공유) ─────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export interface RagSource {
  documentId: string;
  title: string;
  page?: number;
  /** 관리자 업로드 시 base URL + page 조합 */
  url?: string;
}

export interface AssignmentCardPayload {
  assignmentId: string;
  title: string;
  dueAt: string | null;
  courseId: string;
  courseName: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'assignment_card';
  content: string;
  /** 교재 인용 소스 (RAG) */
  sources?: RagSource[];
  /** 과제 알림 카드 페이로드 */
  assignmentCard?: AssignmentCardPayload;
  /** 자율 발화(proactive heartbeat) 메시지 여부 */
  isAutoMessage?: boolean;
  /** 자율 발화 에이전트 이름 (배지 표시용) */
  agentName?: string;
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
  /** 현재 선택된 수강생 ID (메시지 저장 키로 사용) */
  activeStudentId: string | null;
  /** 현재 선택된 과목 ID (메시지 저장 키로 사용) */
  activeCourseId: string | null;

  // ── 액션 ──
  addMessage: (msg: ChatMessage) => void;
  updateStreamingMessage: (id: string, chunk: string) => void;
  removeEmptyMessages: () => void;
  /** 특정 메시지 삭제 */
  deleteMessage: (id: string) => void;
  setIsTyping: (v: boolean) => void;
  setError: (e: string | null) => void;
  setSessionId: (id: string | null) => void;
  setConnectionStatus: (s: ConnectionStatus) => void;
  /** 과목 선택 시: 해당 과목의 저장된 메시지 불러오기 (수강생 ID 포함) */
  loadCourse: (studentId: string, courseId: string) => void;
  /** 현재 과목 대화 전체 삭제 (localStorage 포함) */
  clearMessages: () => void;
  /** 세션 ID만 초기화 (로그아웃·과목 변경 시) — 메시지는 유지 */
  clearSession: () => void;
}

const SESSION_KEY = 'openmento_chat_session';

export const useChatStore = create<ChatState>((set, get) => ({
  // ── 초기 상태 ──
  messages: [],
  isTyping: false,
  error: null,
  sessionId: sessionStorage.getItem(SESSION_KEY),
  connectionStatus: 'connected',
  activeStudentId: null,
  activeCourseId: null,

  // ── 메시지 액션 ──
  addMessage: (msg) =>
    set((s) => {
      const next = [...s.messages, msg];
      if (s.activeStudentId && s.activeCourseId) saveMessages(s.activeStudentId, s.activeCourseId, next);
      return { messages: next };
    }),

  updateStreamingMessage: (id, chunk) =>
    set((s) => {
      const next = s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m,
      );
      if (s.activeStudentId && s.activeCourseId) saveMessages(s.activeStudentId, s.activeCourseId, next);
      return { messages: next };
    }),

  removeEmptyMessages: () =>
    set((s) => {
      const next = s.messages.filter((m) => m.content !== '' || m.role === 'assignment_card');
      if (s.activeStudentId && s.activeCourseId) saveMessages(s.activeStudentId, s.activeCourseId, next);
      return { messages: next };
    }),

  deleteMessage: (id) =>
    set((s) => {
      const next = s.messages.filter((m) => m.id !== id);
      if (s.activeStudentId && s.activeCourseId) saveMessages(s.activeStudentId, s.activeCourseId, next);
      return { messages: next };
    }),

  // ── 상태 세터 ──
  setIsTyping: (v) => set({ isTyping: v }),

  setError: (e) => set({ error: e }),

  setSessionId: (id) => {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
    set({ sessionId: id });
  },

  setConnectionStatus: (s) => set({ connectionStatus: s }),

  loadCourse: (studentId, courseId) => {
    const saved = loadMessages(studentId, courseId);
    set({ activeStudentId: studentId, activeCourseId: courseId, messages: saved, error: null });
  },

  clearMessages: () => {
    const { activeStudentId, activeCourseId } = get();
    if (activeStudentId && activeCourseId) removeMessages(activeStudentId, activeCourseId);
    sessionStorage.removeItem(SESSION_KEY);
    set({ messages: [], sessionId: null, error: null });
  },

  clearSession: () => {
    sessionStorage.removeItem(SESSION_KEY);
    set({ sessionId: null, error: null });
  },
}));
