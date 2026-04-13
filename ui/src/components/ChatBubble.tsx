/**
 * 채팅 말풍선 컴포넌트
 *
 * - 본인 메시지: 오른쪽 / 노란 말풍선 (카카오톡 스타일)
 * - AI 메시지: 왼쪽 / 흰 말풍선 + 아바타 + RAG 인용 링크
 * - 과제 알림 카드: 중앙 / 주황 테두리 카드 + 보기/분석 버튼
 *
 * [v2] hover 액션 메뉴: 복사 / 삭제 / 다시 보내기(사용자 메시지만)
 * [v2] 첫 메시지 상단 여백 pt-3 → Virtuoso Header로 대응
 */

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../hooks/useChat';
import SourceCitation from './SourceCitation';
import { ClipboardList, BookOpen, Sparkles, Copy, Trash2, RotateCcw, Check } from 'lucide-react';

interface ChatBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onViewAssignment?: (assignmentId: string) => void;
  onAnalyzeAssignment?: (title: string) => void;
  onDelete?: (id: string) => void;
  onResend?: (content: string) => void;
}

export default function ChatBubble({
  message,
  isStreaming,
  onViewAssignment,
  onAnalyzeAssignment,
  onDelete,
  onResend,
}: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: execCommand
      const el = document.createElement('textarea');
      el.value = message.content;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // ── 과제 알림 카드 ──────────────────────────────────────────────────────────
  if (message.role === 'assignment_card' && message.assignmentCard) {
    const card = message.assignmentCard;
    return (
      <div className="px-3 py-2">
        <div className="rounded-xl border-2 border-amber-300 dark:border-amber-600 bg-amber-50/80 dark:bg-amber-900/20 p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <div className="shrink-0 w-8 h-8 rounded-lg bg-amber-200 dark:bg-amber-700 flex items-center justify-center">
              <ClipboardList size={16} className="text-amber-700 dark:text-amber-200" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-0.5">
                새 과제 등록됨 · {card.courseName}
              </p>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">
                {card.title}
              </p>
              {card.dueAt && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                  <BookOpen size={10} />
                  제출기한: {new Date(card.dueAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onViewAssignment?.(card.assignmentId)}
              className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition"
            >
              보기
            </button>
            <button
              onClick={() => onAnalyzeAssignment?.(card.title)}
              className="flex-1 text-xs font-medium py-1.5 rounded-lg bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/30 dark:hover:bg-violet-900/50 text-violet-700 dark:text-violet-400 flex items-center justify-center gap-1 transition"
            >
              <Sparkles size={11} /> 분석
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 사용자 메시지 ──────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div
        className="flex justify-end items-end gap-1 mb-1 px-3 group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* hover 액션 메뉴 (삭제, 다시 보내기, 복사) */}
        <div
          className={`flex items-center gap-0.5 transition-all duration-150 ${
            isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'
          }`}
        >
          {onResend && (
            <button
              onClick={() => onResend(message.content)}
              title="다시 보내기"
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            >
              <RotateCcw size={13} />
            </button>
          )}
          <button
            onClick={handleCopy}
            title="복사"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
          </button>
          {onDelete && (
            <button
              onClick={() => onDelete(message.id)}
              title="삭제"
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <span className="text-[10px] text-gray-400 self-end mb-0.5 shrink-0">
          {formatTime(message.createdAt)}
        </span>
        <div
          className="bubble-base bg-[var(--bubble-user)] text-[var(--bubble-user-text)] rounded-br-sm"
          style={{ maxWidth: '75%' }}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // ── AI 메시지 ──────────────────────────────────────────────────────────────
  return (
    <div
      className="flex items-start gap-2 mb-1 px-3 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* AI 아바타 */}
      <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1">
        <img src="/icon-512.png" alt="OpenMento AI" className="w-full h-full object-cover" />
      </div>

      <div className="flex flex-col gap-1 min-w-0" style={{ maxWidth: 'calc(100% - 2.5rem)' }}>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {message.agentName ?? 'OpenMento AI'}
          </span>
          {message.isAutoMessage && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 text-[9px] font-semibold tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              자동 메시지
            </span>
          )}
        </div>

        <div className="flex items-end gap-1 max-w-[85%]">
          <div className="bubble-base bg-[var(--bubble-ai)] border border-gray-100 dark:border-slate-600 rounded-bl-sm shadow-sm text-gray-800 dark:text-gray-100">
            {message.content ? (
              <div className="markdown-body prose prose-sm dark:prose-invert prose-p:leading-relaxed prose-pre:bg-gray-100 dark:prose-pre:bg-slate-800 prose-pre:text-gray-800 dark:prose-pre:text-gray-100 max-w-none break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
                {isStreaming && <span className="inline-block w-1 h-4 bg-gray-400 animate-pulse ml-0.5 align-text-bottom" />}
              </div>
            ) : (
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

        {/* hover 액션 메뉴 (복사, 삭제) */}
        {!isStreaming && (
          <div
            className={`flex items-center gap-0.5 transition-all duration-150 ${
              isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'
            }`}
          >
            <button
              onClick={handleCopy}
              title="복사"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
            {onDelete && (
              <button
                onClick={() => onDelete(message.id)}
                title="삭제"
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
