/**
 * 교재 페이지 인용 링크 (RAG 소스 표시)
 *
 * 예: 📄 Java 기초 교재 p.42
 *     클릭 시 URL로 이동 (관리자가 설정한 교재 URL + page)
 */

import type { RagSource } from '../hooks/useChat';

interface SourceCitationProps {
  source: RagSource;
}

export default function SourceCitation({ source }: SourceCitationProps) {
  const label = source.page ? `${source.title} p.${source.page}` : source.title;

  if (source.url) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="
          inline-flex items-center gap-1 px-2 py-0.5
          rounded-full bg-blue-50 border border-blue-200
          text-[11px] text-blue-600 hover:text-blue-800
          hover:bg-blue-100 transition
        "
        title={`교재 원문 바로가기: ${label}`}
      >
        <span aria-hidden>📄</span>
        <span>{label}</span>
      </a>
    );
  }

  return (
    <span
      className="
        inline-flex items-center gap-1 px-2 py-0.5
        rounded-full bg-gray-100 border border-gray-200
        text-[11px] text-gray-500
      "
    >
      <span aria-hidden>📄</span>
      <span>{label}</span>
    </span>
  );
}
