/**
 * AI 튜터 채팅 훅 (Zustand 기반 전역 상태 + 소켓 재연결 처리)
 *
 * Socket.io 이벤트 흐름:
 *   질문 전송 → typing_start → chat_chunk(스트리밍) → chat_done
 *
 * 개선 사항:
 *   1. 연결 상태(connected / reconnecting / disconnected) 추적 → UI 배너 노출
 *   2. 재연결 성공 시 세션 룸 자동 재입장 (밀린 대화 복구 대비)
 *   3. 채팅 상태를 Zustand 스토어로 분리 → Phase 4 다중 에이전트 확장에 대비
 *
 * 이벤트 핸들러 내부에서 상태에 접근할 때는 stale 클로저를 방지하기 위해
 * useChatStore.getState()를 직접 호출한다.
 */

import { useCallback, useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useChatStore } from '../store/chatStore';

// 공개 타입을 스토어에서 재-익스포트 (하위 호환 유지)
export type { ChatMessage, RagSource, ConnectionStatus } from '../store/chatStore';

interface ChatDonePayload {
  sessionId: string;
  ragSourceCount: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface CodeReviewArrivedPayload {
  sessionId: string;
  messageId: string;
  repo: string;
  event: 'push' | 'pull_request';
  preview: string;
}

// 모듈 레벨 싱글턴 소켓 — 컴포넌트 언마운트 후에도 연결을 유지한다.
let sharedSocket: Socket | null = null;

function getOrCreateSocket(token: string): Socket {
  if (!sharedSocket) {
    sharedSocket = io('/', {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return sharedSocket;
}

/**
 * 현재 연결된 소켓 인스턴스를 반환합니다.
 * 소켓이 없거나 아직 연결 전이면 token 으로 생성합니다.
 * onboarding 훅 등 채팅 밖 컨텍스트에서 소켓 이벤트를 구독할 때 사용합니다.
 * Gemini 제언 ②: onboarding:completed 크로스-탭 동기화에 활용.
 */
export function getSharedSocket(token: string): Socket {
  return getOrCreateSocket(token);
}

interface UseChatOptions {
  agentId: string;
  courseId?: string;
}

export function useChat({ agentId, courseId }: UseChatOptions) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  // 현재 스트리밍 중인 AI 메시지 ID
  const streamingIdRef = useRef<string | null>(null);

  // 컴포넌트가 구독하는 최소 상태 슬라이스
  const messages = useChatStore((s) => s.messages);
  const isTyping = useChatStore((s) => s.isTyping);
  const error = useChatStore((s) => s.error);
  const sessionId = useChatStore((s) => s.sessionId);
  const connectionStatus = useChatStore((s) => s.connectionStatus);

  // 소켓 연결 및 이벤트 바인딩
  useEffect(() => {
    if (!token) return;

    const socket = getOrCreateSocket(token);
    socketRef.current = socket;

    // 초기 세션 룸 입장
    const { sessionId: currentSid } = useChatStore.getState();
    if (currentSid) socket.emit('join_session', currentSid);

    // ── 연결 상태 이벤트 ───────────────────────────────────────────────────────

    /** 연결(재연결 포함) 성공 */
    const onConnect = () => {
      useChatStore.getState().setConnectionStatus('connected');
      // 재연결 시 세션 룸 재입장 → 서버가 밀린 이벤트 재브로드캐스트 가능
      const { sessionId: sid } = useChatStore.getState();
      if (sid) socket.emit('join_session', sid);
    };

    /** 연결 끊김 */
    const onDisconnect = () =>
      useChatStore.getState().setConnectionStatus('disconnected');

    /** 재연결 시도 중 */
    const onReconnectAttempt = () =>
      useChatStore.getState().setConnectionStatus('reconnecting');

    // ── 채팅 이벤트 ───────────────────────────────────────────────────────────

    /** AI 응답 스트리밍 시작: 빈 메시지 슬롯 생성 */
    const onTypingStart = () => {
      const id = crypto.randomUUID();
      streamingIdRef.current = id;
      const store = useChatStore.getState();
      store.setIsTyping(true);
      store.setError(null);
      store.addMessage({ id, role: 'assistant', content: '', createdAt: new Date() });
    };

    /** 텍스트 청크 수신: 스트리밍 메시지에 이어 붙임 */
    const onChunk = ({ chunk }: { chunk: string }) => {
      const id = streamingIdRef.current;
      if (!id) return;
      useChatStore.getState().updateStreamingMessage(id, chunk);
    };

    /** 스트리밍 완료: 세션 ID 영속화 */
    const onDone = (data: ChatDonePayload) => {
      const store = useChatStore.getState();
      store.setIsTyping(false);
      streamingIdRef.current = null;
      store.setSessionId(data.sessionId);
    };

    /** 서버 측 오류: 빈 메시지 슬롯 제거 후 에러 표시 */
    const onChatError = ({ message }: { message: string }) => {
      const store = useChatStore.getState();
      store.setIsTyping(false);
      streamingIdRef.current = null;
      store.removeEmptyMessages();
      store.setError(message);
    };

    /** GitHub 코드 리뷰 도착 (Phase 2-5): 채팅창에 알림 메시지 추가 */
    const onCodeReviewArrived = (data: CodeReviewArrivedPayload) => {
      const store = useChatStore.getState();
      const eventLabel = data.event === 'push' ? 'Push' : 'Pull Request';
      store.addMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `🔍 **[GitHub 코드 리뷰 도착]** — \`${data.repo}\` (${eventLabel})\n\n${data.preview}\n\n_전체 리뷰를 보려면 채팅 목록을 확인하세요._`,
        createdAt: new Date(),
      });
      // 새 세션으로 전환 (코드 리뷰 세션 확인 방식)
      store.setSessionId(data.sessionId);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on('typing_start', onTypingStart);
    socket.on('chat_chunk', onChunk);
    socket.on('chat_done', onDone);
    socket.on('chat_error', onChatError);
    socket.on('code_review_arrived', onCodeReviewArrived);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('typing_start', onTypingStart);
      socket.off('chat_chunk', onChunk);
      socket.off('chat_done', onDone);
      socket.off('chat_error', onChatError);
      socket.off('code_review_arrived', onCodeReviewArrived);
    };
  }, [token]); // token 변경 시만 재바인딩 — 상태는 getState()로 직접 접근

  const sendMessage = useCallback(
    (question: string) => {
      if (!question.trim()) return;
      const store = useChatStore.getState();
      if (store.isTyping) return;

      store.addMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: question.trim(),
        createdAt: new Date(),
      });

      socketRef.current?.emit('chat_message', {
        question: question.trim(),
        agentId,
        sessionId: store.sessionId ?? undefined,
        courseId,
      });
    },
    [agentId, courseId],
  );

  return {
    messages,
    isTyping,
    error,
    sessionId,
    connectionStatus,
    sendMessage,
    clearSession: useChatStore.getState().clearSession,
  };
}
