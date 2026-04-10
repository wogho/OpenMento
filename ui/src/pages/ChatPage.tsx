/**
 * 수강생 AI 튜터 채팅 페이지 (Phase 1-4 핵심)
 *
 * 레이아웃:
 *   ┌──────────────────┐
 *   │  헤더 (과목명, 메뉴) │
 *   ├──────────────────┤
 *   │  연결 상태 배너    │  ← 재연결 중일 때만 표시
 *   ├──────────────────┤
 *   │                  │
 *   │   메시지 목록     │  ← react-virtuoso 가상화
 *   │                  │
 *   ├──────────────────┤
 *   │  채팅 입력창      │
 *   └──────────────────┘
 *
 * 모바일 320px ~ 데스크톱 1920px 반응형
 */

import { useNavigate } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../hooks/useAuth';
import { useChat, type ChatMessage } from '../hooks/useChat';
import ChatBubble from '../components/ChatBubble';
import ChatErrorBoundary from '../components/ChatErrorBoundary';
import TypingIndicator from '../components/TypingIndicator';
import ChatInput from '../components/ChatInput';
import posthog from 'posthog-js';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Phase 1에서는 에이전트 ID를 환경변수 또는 고정값으로 사용
// Phase 3에서 수강생 과정에 연결된 에이전트를 동적으로 조회하도록 교체
const DEFAULT_AGENT_ID =
  import.meta.env.VITE_TUTOR_AGENT_ID ?? '00000000-0000-0000-0000-000000000001';

// ── 연결 상태 배너 ────────────────────────────────────────────────────────────

function ConnectionBanner({ status }: { status: 'reconnecting' | 'disconnected' }) {
  const isReconnecting = status === 'reconnecting';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        shrink-0 flex items-center justify-center gap-2 py-2 text-xs font-medium
        transition-colors duration-300
        ${isReconnecting ? 'bg-yellow-400 text-yellow-900' : 'bg-red-500 text-white'}
      `}
    >
      {isReconnecting ? (
        <>
          <span className="inline-block animate-spin" aria-hidden="true">⟳</span>
          AI 서버와 재연결 중...
        </>
      ) : (
        <>⚠️ AI 서버와 연결이 끊어졌습니다. 잠시 후 자동 재시도합니다.</>
      )}
    </div>
  );
}

// ── 빈 대화 안내 ──────────────────────────────────────────────────────────────

function EmptyState({ onExampleClick }: { onExampleClick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-8 gap-3">
      <div className="w-16 h-16 rounded-2xl bg-white shadow flex items-center justify-center text-3xl">
        📚
      </div>
      <p className="text-base font-semibold text-gray-700">무엇이 궁금한가요?</p>
      <p className="text-sm text-gray-500 leading-relaxed">
        교재 내용, 개념 설명, 코드 원리 등<br />
        궁금한 것을 자유롭게 물어보세요.
      </p>
      <div className="flex flex-wrap gap-2 justify-center mt-2">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onExampleClick(q)}
            className="
              text-xs bg-white border border-gray-200 rounded-full
              px-3 py-1.5 text-gray-600 hover:border-gray-400 hover:text-gray-800
              transition shadow-sm
            "
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { messages, isTyping, error, connectionStatus, sendMessage, clearSession } = useChat({
    agentId: DEFAULT_AGENT_ID,
  });

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  // Virtuoso에 전달할 표시 메시지 목록 (스트리밍 시작 전 빈 슬롯 제외)
  const visibleMessages = messages.filter((m) => m.content !== '');
  // 현재 스트리밍 중인 AI 메시지 ID (커서 깜빡임 표시용)
  const streamingAiId = isTyping
    ? [...messages].reverse().find((m) => m.role === 'assistant')?.id
    : undefined;
  // 스트리밍 시작 전 빈 슬롯이 있을 때 타이핑 인디케이터 표시
  const showTypingIndicator =
    isTyping && messages.some((m) => m.role === 'assistant' && m.content === '');

  return (
    <div className="chat-layout">
      {/* ── 헤더 ── */}
      <header
        className="shrink-0 flex items-center justify-between px-4 py-3 text-white"
        style={{ background: 'var(--header-bg)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg" role="img" aria-label="AI 튜터">🤖</span>
          <div>
            <p className="text-sm font-semibold leading-tight">EduClip AI 튜터</p>
            <p className="text-[11px] opacity-70 leading-tight">교재 기반 소크라테스식 답변</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 포트폴리오 이동 (온보딩 투어 타깃 #portfolio-nav-btn) */}
          <button
            id="portfolio-nav-btn"
            onClick={() => navigate('/portfolio')}
            title="포트폴리오 기획서 작성"
            aria-label="포트폴리오 기획서 이동"
            className="text-white/70 hover:text-white transition text-lg"
          >
            🎓
          </button>

          {/* 새 대화 시작 */}
          <button
            onClick={clearSession}
            title="새 대화 시작"
            aria-label="새 대화 시작"
            className="text-white/70 hover:text-white transition text-lg"
          >
            ✏️
          </button>

          {/* 사용자 정보 + 로그아웃 */}
          <button
            onClick={handleLogout}
            title={`${user?.name ?? user?.sub} · 로그아웃`}
            aria-label="로그아웃"
            className="
              text-[11px] bg-white/10 hover:bg-white/20
              rounded-full px-2.5 py-1 transition
            "
          >
            {user?.name ?? '로그아웃'}
          </button>
        </div>
      </header>

      {/* ── 소켓 연결 상태 배너 (재연결 중 / 끊김 시만 표시) ── */}
      {connectionStatus !== 'connected' && (
        <ConnectionBanner status={connectionStatus} />
      )}

      {/* ── 메시지 목록 (온보딩 투어 타깃 #chat-messages) ── */}
      <main id="chat-messages" className="flex-1 overflow-hidden flex flex-col">
        {/* 빈 대화 안내 */}
        {visibleMessages.length === 0 && !isTyping ? (
          <EmptyState onExampleClick={sendMessage} />
        ) : (
          /* react-virtuoso 가상화: 수백 개 메시지도 DOM 20~30개만 렌더링 */
          <ChatErrorBoundary>
            <Virtuoso aria-label="채팅 메시지 목록"<ChatMessage>
              style={{ flex: 1 }}
              data={visibleMessages}
              followOutput="smooth"
              itemContent={(_, msg) => (
                <ChatBubble
                  message={msg}
                  isStreaming={
                    isTyping &&
                    msg.id === streamingAiId &&
                    msg.role === 'assistant'
                  }
                />
              )}
              components={{
                /* 스트리밍 시작 대기 중 타이핑 인디케이터 */
                Footer: () =>
                  showTypingIndicator ? (
                    <div className="px-3 py-1">
                      <TypingIndicator />
                    </div>
                  ) : null,
              }}
            />
          </ChatErrorBoundary>
        )}

        {/* 서버 오류 인라인 배너 */}
        {error && (
          <div className="shrink-0 mx-3 mb-2">
            <div role="alert" aria-live="assertive" className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">
              ⚠️ {error}
            </div>
          </div>
        )}
      </main>

      {/* ── 입력창 (온보딩 투어 타깃 #chat-input) ── */}
      <footer id="chat-input" className="shrink-0">
        <ChatInput onSend={sendMessage} disabled={isTyping} />
      </footer>
    </div>
  );
}

const EXAMPLE_QUESTIONS = [
  'Java의 인터페이스와 추상 클래스 차이는?',
  'Spring MVC 동작 흐름을 설명해 주세요',
  '이 코드에서 왜 NullPointerException이 날까요?',
];
