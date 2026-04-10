/**
 * 채팅 입력창 컴포넌트
 *
 * - textarea 자동 높이 조절 (최대 5줄)
 * - Enter 전송 / Shift+Enter 줄바꿈
 * - AI 응답 중에는 전송 비활성화
 */

import { useRef, useState, type KeyboardEvent, type ChangeEvent } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 최대 5줄 (line-height 1.5 * font-size 14px = 21px, 5줄 = ~105px)
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    adjustHeight();
  };

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
    // 높이 리셋
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input-bar safe-area-pb">
      <textarea
        autoFocus
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={disabled ? 'AI가 답변 중입니다...' : '질문을 입력하세요 (Enter로 전송)'}
        aria-label="채팅 입력창"
        className="
          flex-1 resize-none rounded-2xl border border-gray-300
          px-3.5 py-2.5 text-sm leading-relaxed
          focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
          disabled:bg-gray-50 disabled:text-gray-400
          transition overflow-hidden
        "
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        aria-label="전송"
        className="
          shrink-0 w-10 h-10 rounded-full
          bg-[var(--header-bg)] text-white
          flex items-center justify-center
          hover:opacity-80 active:scale-95
          disabled:opacity-40 disabled:cursor-not-allowed
          transition
        "
      >
        {/* 전송 아이콘 (SVG) */}
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  );
}
