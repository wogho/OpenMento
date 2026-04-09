/**
 * Phase 5-3 — OnboardingTour 컴포넌트
 *
 * App.tsx에 단 한 번 삽입하면 역할별 투어가 자동으로 실행됩니다.
 * 투어 완료 후 재표시 방지를 위한 "투어 다시 보기" 플로팅 버튼도 제공합니다.
 */

import { useOnboarding } from '../hooks/useOnboarding';
import { useAuth } from '../hooks/useAuth';

export default function OnboardingTour() {
  const { user } = useAuth();
  const { isRunning, restartTour } = useOnboarding();

  // 로그인 전이거나 투어가 실행 중이면 플로팅 버튼 숨김
  if (!user || isRunning) return null;

  return (
    <button
      id="onboarding-restart-btn"
      onClick={restartTour}
      aria-label="온보딩 투어 다시 보기"
      title="온보딩 투어 다시 보기"
      className="
        fixed bottom-6 right-6 z-50
        w-11 h-11 rounded-full shadow-lg
        flex items-center justify-center
        bg-blue-600 hover:bg-blue-700 active:scale-95
        text-white text-lg
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2
      "
    >
      🧭
    </button>
  );
}
