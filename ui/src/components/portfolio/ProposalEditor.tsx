/**
 * ProposalEditor — 포트폴리오 기획서 작성 에디터
 *
 * - 마크다운 지원 textarea (기존 @uiw/react-md-editor 대신 경량 textarea 사용)
 * - 서식 툴바: 굵게/기울임/목록/코드블록/표
 * - "유사도 분석 요청" 버튼 → onAnalyze 콜백
 * - isAnalyzing 상태에서 분석 중 스피너 표시
 */

import { useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  disabled?: boolean;
}

interface ToolbarAction {
  label: string;
  title: string;
  prefix: string;
  suffix: string;
  block?: boolean;
}

const TOOLBAR: ToolbarAction[] = [
  { label: 'B',  title: '굵게',     prefix: '**',  suffix: '**'  },
  { label: 'I',  title: '기울임',   prefix: '*',   suffix: '*'   },
  { label: '—',  title: '목록',     prefix: '\n- ', suffix: '',  block: true },
  { label: '<>', title: '인라인 코드', prefix: '`',  suffix: '`'  },
  { label: '⬛', title: '코드블록',  prefix: '\n```\n', suffix: '\n```', block: true },
  { label: '⊞',  title: '표',       prefix: '\n| 컬럼1 | 컬럼2 |\n|---|---|\n| 값1 | 값2 |', suffix: '', block: true },
];

export default function ProposalEditor({ value, onChange, onAnalyze, isAnalyzing, disabled }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const charCount = value.length;

  const applyFormat = (action: ToolbarAction) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? 0;
    const end   = el.selectionEnd   ?? 0;
    const selected = value.slice(start, end);

    const newText =
      value.slice(0, start) +
      action.prefix +
      selected +
      action.suffix +
      value.slice(end);

    onChange(newText);

    // 커서 위치 복원
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + action.prefix.length + selected.length + action.suffix.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 서식 툴바 */}
      <div className="flex flex-wrap gap-1 p-1.5 bg-gray-50 rounded-xl border border-gray-200">
        {TOOLBAR.map((action) => (
          <button
            key={action.title}
            type="button"
            title={action.title}
            onClick={() => applyFormat(action)}
            disabled={disabled}
            className="
              px-2.5 py-1 text-xs font-mono font-semibold text-gray-600
              bg-white border border-gray-200 rounded-lg
              hover:bg-gray-100 hover:border-gray-300
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors duration-100
            "
          >
            {action.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center pr-1 tabular-nums">
          {charCount.toLocaleString()}자
        </span>
      </div>

      {/* 에디터 */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || isAnalyzing}
        rows={18}
        placeholder={`포트폴리오 기획서를 작성해 주세요.\n\n## 프로젝트 개요\n\n## 목표 사용자 (페르소나)\n\n## 핵심 기능 목록\n\n## 기술 스택\n\n## 차별화 포인트`}
        className="
          w-full resize-none rounded-xl border border-gray-300 bg-white
          px-4 py-3 text-sm text-gray-800 leading-relaxed font-mono
          focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          placeholder:font-sans placeholder:text-gray-400
        "
      />

      {/* 유사도 분석 버튼 */}
      <button
        type="button"
        onClick={onAnalyze}
        disabled={disabled || isAnalyzing || charCount < 50}
        className="
          w-full py-3 rounded-xl text-sm font-semibold
          bg-blue-600 text-white hover:bg-blue-700
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors duration-150 flex items-center justify-center gap-2
        "
      >
        {isAnalyzing ? (
          <>
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            독창성 분석 중…
          </>
        ) : (
          <>🔍 독창성 분석 요청 (역대 수료생 프로젝트와 비교)</>
        )}
      </button>

      {charCount < 50 && charCount > 0 && (
        <p className="text-xs text-amber-600 text-center">
          기획서를 50자 이상 작성해야 분석을 요청할 수 있습니다. ({charCount}/50)
        </p>
      )}
    </div>
  );
}
