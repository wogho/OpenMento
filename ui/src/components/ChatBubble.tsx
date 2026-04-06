/**
 * 채팅 말풍선 컴포넌트
 *
 * - 본인 메시지: 오른쪽 / 노란 말풍선 (카카오톡 스타일)
 * - AI 메시지: 왼쪽 / 흰 말풍선 + 아바타 + RAG 인용 링크
 */

import type { ChatMessage } from '../hooks/useChat';
import SourceCitation from './SourceCitation';

interface ChatBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

export default function ChatBubble({ message, isStreaming }: ChatBubbleProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end items-end gap-1 mb-1 px-3">
        <span className="text-[10px] text-gray-400 self-end mb-0.5 shrink-0">
          {formatTime(message.createdAt)}
        </span>
        <div
          className="bubble-base bg-[var(--bubble-user)] rounded-br-sm"
          style={{ maxWidth: '75%' }}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // AI 메시지
  return (
    <div className="flex items-start gap-2 mb-1 px-3">
      {/* AI 아바타 */}
      <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--header-bg)] flex items-center justify-center text-sm mt-1">
        🤖
      </div>

      <div className="flex flex-col gap-1 min-w-0" style={{ maxWidth: 'calc(100% - 2.5rem)' }}>
        <span className="text-xs font-medium text-gray-600">EduClip AI</span>

        <div className="flex items-end gap-1">
          <div className="bubble-base bg-[var(--bubble-ai)] border border-gray-100 rounded-bl-sm shadow-sm">
            {message.content ? (
              <>
                <p className="whitespace-pre-wrap">{message.content}</p>
                {isStreaming && <span className="inline-block w-1 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />}
              </>
            ) : (
              // 빈 content → 타이핑 인디케이터가 별도 컴포넌트로 표시됨
              <span className="sr-only">응답 대기 중</span>
            )}
          </div>
          {!isStreaming && (
            <span className="text-[10px] text-gray-400 self-end mb-0.5 shrink-0">
              {formatTime(message.createdAt)}
            </span>
          )}
        </div>

        {/* RAG 인용 소스 링크 */}
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.sources.map((src) => (
              <SourceCitation key={src.documentId} source={src} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
