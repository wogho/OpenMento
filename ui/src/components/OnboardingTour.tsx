/**
 * Phase 5-3 개선 — OnboardingTour 컴포넌트
 *
 * App.tsx 에 단 한 번 삽입하면 역할별·기능별 투어가 자동으로 실행됩니다.
 *
 * 투어 목록:
 *    기본 투어    — 역할(admin/instructor/student) 최초 로그인 시 자동 실행
 *    포트폴리오 투어 — /portfolio 최초 방문 시 수강생에게 자동 실행 (Gemini ③)
 *    EWS 투어     — /admin 최초 방문 시 admin/instructor 에게 자동 실행 (Gemini ③)
 *
 * 투어 미실행 중에는 해당 페이지에서 플로팅 "다시 보기" 버튼이 표시됩니다.
 */

import { useLocation } from 'react-router-dom';
import { useOnboarding } from '../hooks/useOnboarding';
import { useFeatureTour } from '../hooks/useFeatureTour';
import { useAuth } from './/../hooks/useAuth';
import { HelpCircle, PanelTop, AlertTriangle } from 'lucide-react';

export default function OnboardingTour() {
  const { user } = useAuth();
  const location = useLocation();

  // 역할 기반 기본 투어
  const { isRunning: roleRunning, restartTour: restartRole } = useOnboarding();

  // 포트폴리오 기능 투어 (Gemini 제언 ③)
  const { isRunning: portfolioRunning, restartTour: restartPortfolio } = useFeatureTour(
    'portfolio-tour',
    () => location.pathname === '/portfolio' && user?.role === 'student',
  );

  // EWS 기능 투어 (Gemini 제언 ③)
  const { isRunning: ewsRunning, restartTour: restartEws } = useFeatureTour(
    'ews-tour',
    () =>
      location.pathname.startsWith('/admin') &&
      (user?.role === 'admin' || user?.role === 'teacher'),
  );

  if (!user) return null;

  const isAnyRunning = roleRunning || portfolioRunning || ewsRunning;
  const isOnPortfolio = location.pathname === '/portfolio';
  const isOnAdmin = location.pathname.startsWith('/admin');
  const canEws = user.role === 'admin' || user.role === 'teacher';

  return (
    <>
      {/* 투어 실행 중이 아닐 때 플로팅 다시 보기 버튼 */}
      {!isAnyRunning && (
        <div
          id="onboarding-restart-btn"
          className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end"
        >
          {/* 항상 표시: 역할 기반 기본 투어 */}
          <button
            onClick={restartRole}
            aria-label="기본 온보딩 투어 다시 보기"
            title="기본 온보딩 투어 다시 보기"
            className="
              w-11 h-11 rounded-full shadow-lg
              flex items-center justify-center
              bg-blue-600 hover:bg-blue-700 active:scale-95
              text-white text-lg
              transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2
            "
          >
            <HelpCircle size={20} />
          </button>

          {/* 포트폴리오 페이지에서만 표시 */}
          {isOnPortfolio && (
            <button
              onClick={restartPortfolio}
              aria-label="포트폴리오 투어 다시 보기"
              title="포트폴리오 투어 다시 보기"
              className="
                w-11 h-11 rounded-full shadow-lg
                flex items-center justify-center
                bg-purple-600 hover:bg-purple-700 active:scale-95
                text-white text-lg
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2
              "
            >
              <PanelTop size={20} />
            </button>
          )}

          {/* 어드민 페이지에서 admin/instructor 역할에게만 표시 */}
          {isOnAdmin && canEws && (
            <button
              onClick={restartEws}
              aria-label="EWS 투어 다시 보기"
              title="EWS 투어 다시 보기"
              className="
                w-11 h-11 rounded-full shadow-lg
                flex items-center justify-center
                bg-amber-600 hover:bg-amber-700 active:scale-95
                text-white text-lg
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2
              "
            >
              <AlertTriangle size={20} />
            </button>
          )}
        </div>
      )}
    </>
  );
}

