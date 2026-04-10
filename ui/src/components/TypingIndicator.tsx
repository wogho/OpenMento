/**
 * "AI가 답변 중..." 타이핑 인디케이터
 *
 * 세 개의 점이 순차적으로 커지며 반복되는 애니메이션
 */

import Lottie from 'lottie-react';
import thinkingAnimation from '../assets/lottie/thinking.json';

export default function TypingIndicator() {
  return (
    <div className="flex items-start gap-2 mb-1 px-3">
      {/* AI 아바타 */}
      <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--header-bg)] flex items-center justify-center text-sm">
        🤖
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-600">OpenMento AI</span>
        <div role="status" aria-live="polite" className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 flex items-center gap-1">
          <Lottie
            animationData={thinkingAnimation}
            loop={true}
            autoplay={true}
            style={{ width: 24, height: 24 }}
          />
          <span className="sr-only">AI가 답변 중입니다</span>
        </div>
      </div>
    </div>
  );
}
