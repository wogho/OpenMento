/**
 * Phase 5-3 — 온보딩 투어 상태 관리 훅 (역할 기반 투어)
 *
 * useFeatureTour 를 내부적으로 사용하는 thin wrapper.
 * 로그인 후 해당 역할의 투어가 미완료이면 자동으로 실행합니다.
 *
 * 개선 사항 (Gemini 제언 반영):
 *   ① Intermediate Progress: useFeatureTour 에서 스텝별 서버 동기화
 *   ② Cross-Tab Sync: useFeatureTour 에서 socket.io 이벤트 구독
 *   ③ Feature-based Tours: useFeatureTour 의 triggerCondition 활용
 */

import { useAuth } from './useAuth';
import { getTourForRole } from '../tours/scenarios';
import { useFeatureTour, type UseFeatureTourReturn } from './useFeatureTour';

// 하위 호환용 타입 재-익스포트
export type UseOnboardingReturn = UseFeatureTourReturn;

/**
 * 사용자 역할에 맞는 기본 온보딩 투어를 관리합니다.
 * - admin/instructor → admin-tour
 * - student         → student-tour
 */
export function useOnboarding(): UseFeatureTourReturn {
  const { user } = useAuth();
  const scenario = user ? getTourForRole(user.role) : undefined;

  // Rules of Hooks: 조건부 호출 불가 — tourId 가 없으면 condition 으로 실행 방지
  return useFeatureTour(
    scenario?.tourId ?? 'admin-tour',
    () => !!scenario?.tourId,
  );
}


