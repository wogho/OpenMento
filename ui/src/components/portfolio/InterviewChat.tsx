/**
 * InterviewChat — 페르소나 인터뷰 채팅 UI
 *
 * plan.md 4-1: 고객 페르소나 에이전트 ↔ 수강생 인터뷰 시뮬레이션
 *
 * 기능:
 *  - 페르소나별 아바타(이모지 + 산업명) 표시
 *  - 메시지 말풍선 (user/assistant 방향 분리)
 *  - "AI 답변 중..." 타이핑 인디케이터
 *  - 엔터(Shift+Enter = 줄바꿈) 전송
 *
 * Props:
 *   goalId        — 진행 중인 Goal UUID
 *   messages      — 대화 이력
 *   personaName   — 현재 페르소나 이름
 *   personaIndustry — 페르소나 산업군
 *   isTyping      — AI 입력 중 여부
 *   isFinished    — 인터뷰 완료(planning 단계로 전환됨) 여부
 *   onSend        — 메시지 전송 핸들러
 */

import { useEffect, useRef, useState } from 'react';

export interface InterviewMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// 산업군별 아바타 이모지
const INDUSTRY_EMOJI: Record<string, string> = {
  fintech:      '🏦',
  healthcare:   '🏥',
  ecommerce:    '🛒',
  education:    '🎓',
  logistics:    '🚚',
  entertainment: '🎬',
  smart_city:   '🏙️',
  hr:           '💼',
  food:         '🍽️',
  travel:       '✈️',
};

function getEmoji(industry?: string) {
  if (!industry) return '🤖';
  return INDUSTRY_EMOJI[industry] ?? '🤖';
}

interface Props {
  messages: InterviewMessage[];
  personaName?: string;
  personaIndustry?: string;
  isTyping: boolean;
  isFinished: boolean;
  onSend: (content: string) => void;
  /** SSE 스트리밍 중에 실시간으로 쌓이는 텍스트 (개선③) */
  streamingContent?: string;
}

export default function InterviewChat({
  messages,
  personaName,
  personaIndustry,
  isTyping,
  isFinished,
  onSend,
  streamingContent,
}: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emoji = getEmoji(personaIndustry);

  // 새 메시지 수신 시 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isTyping || isFinished) return;
    onSend(trimmed);
    setInput('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[420px] bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      {/* 페르소나 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border-b border-indigo-100">
        <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-2xl select-none">
          {emoji}
        </div>
        <div>
          <p className="text-sm font-bold text-indigo-900">{personaName ?? '고객 페르소나'}</p>
          <p className="text-xs text-indigo-500">
            {personaIndustry
              ? `${personaIndustry} 업계 고객 역할 시뮬레이션`
              : '요구사항 인터뷰 진행 중'}
          </p>
        </div>
        {isFinished && (
          <span className="ml-auto text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
            인터뷰 완료
          </span>
        )}
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">
            페르소나 에이전트가 인터뷰를 시작합니다…
          </p>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* 아바타 */}
            <div
              className={`
                w-8 h-8 rounded-xl flex items-center justify-center text-base shrink-0
                ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-white border border-gray-200 shadow-sm'}
              `}
            >
              {msg.role === 'user' ? '👤' : emoji}
            </div>

            {/* 말풍선 */}
            <div
              className={`
                max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
                ${msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-tr-sm'
                  : 'bg-gray-100 text-gray-800 rounded-tl-sm'}
              `}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* 스트리밍 말풍선 — SSE 수신 중 실시간 타이핑 표시 (개선③) */}
        {streamingContent && (
          <div className="flex gap-2 flex-row">
            <div className="w-8 h-8 rounded-xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-base">
              {emoji}
            </div>
            <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-gray-100 text-gray-800">
              {streamingContent}
              <span className="inline-block w-0.5 h-3.5 bg-gray-500 ml-0.5 align-middle animate-pulse" />
            </div>
          </div>
        )}

        {/* 타이핑 인디케이터 — 스트리밍이 시작되기 전 대기 상태 표시 */}
        {isTyping && !streamingContent && (
          <div className="flex gap-2 flex-row">
            <div className="w-8 h-8 rounded-xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-base">
              {emoji}
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
        {isFinished ? (
          <p className="text-center text-sm text-gray-500 font-medium py-1">
            ✅ 인터뷰가 종료되었습니다. 기획서 작성 단계로 진행하세요.
          </p>
        ) : (
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="고객 역할의 페르소나에게 요구사항을 설명하세요… (Enter 전송, Shift+Enter 줄바꿈)"
              disabled={isTyping}
              className="
                flex-1 resize-none rounded-xl border border-gray-300 bg-white
                px-3 py-2 text-sm text-gray-800 leading-relaxed
                focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="
                shrink-0 px-4 py-2 rounded-xl text-sm font-semibold
                bg-indigo-600 text-white hover:bg-indigo-700
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors duration-150
              "
            >
              전송
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
