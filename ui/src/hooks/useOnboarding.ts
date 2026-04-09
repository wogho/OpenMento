/**
 * Phase 5-3 — 온보딩 투어 상태 관리 훅
 *
 * - 서버에서 완료된 투어 목록을 조회합니다.
 * - 역할에 맞는 미완료 투어가 있으면 자동으로 driver.js 투어를 실행합니다.
 * - 투어 완료 시 서버에 기록하여 재표시를 방지합니다.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useAuth } from './useAuth';
import { getTourForRole, type TourId } from '../tours/scenarios';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

async function fetchCompletedTours(token: string): Promise<TourId[]> {
  try {
    const res = await fetch(`${API_BASE}/onboarding/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { completedTours: TourId[] };
    return data.completedTours;
  } catch {
    return [];
  }
}

async function markTourComplete(token: string, tourId: TourId): Promise<void> {
  try {
    await fetch(`${API_BASE}/onboarding/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tourId }),
    });
  } catch {
    // 완료 기록 실패는 UX를 차단하지 않음
  }
}

export interface UseOnboardingReturn {
  /** 현재 투어가 실행 중인지 여부 */
  isRunning: boolean;
  /** 수동으로 투어를 다시 시작합니다 */
  restartTour: () => void;
  /** 투어를 완료로 표시하고 종료합니다 */
  skipTour: () => void;
}

export function useOnboarding(): UseOnboardingReturn {
  const { user, token } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const hasStartedRef = useRef(false);

  const startTour = useCallback(() => {
    if (!user || !token) return;

    const scenario = getTourForRole(user.role);
    if (!scenario) return;

    // 투어 대상 요소가 DOM에 존재하는지 확인
    const firstElement = document.getElementById(
      scenario.steps[0].element?.toString().replace('#', '') ?? ''
    );
    if (!firstElement) return;

    setIsRunning(true);

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: '다음 ›',
      prevBtnText: '‹ 이전',
      doneBtnText: '시작하기 🚀',
      steps: scenario.steps,
      onDestroyed: () => {
        setIsRunning(false);
        void markTourComplete(token, scenario.tourId);
      },
    });

    driverRef.current = driverObj;
    driverObj.drive();
  }, [user, token]);

  // 초기 로드 시 미완료 투어 자동 실행
  useEffect(() => {
    if (!user || !token || hasStartedRef.current) return;

    const scenario = getTourForRole(user.role);
    if (!scenario) return;

    void fetchCompletedTours(token).then((completedTours) => {
      if (completedTours.includes(scenario.tourId)) return;

      // DOM 렌더링 완료 후 약간의 지연으로 요소 존재 보장
      const timer = setTimeout(() => {
        hasStartedRef.current = true;
        startTour();
      }, 800);

      return () => clearTimeout(timer);
    });
  }, [user, token, startTour]);

  const restartTour = useCallback(() => {
    hasStartedRef.current = false;
    driverRef.current?.destroy();
    startTour();
  }, [startTour]);

  const skipTour = useCallback(() => {
    driverRef.current?.destroy();
    setIsRunning(false);
    if (user?.role && token) {
      const scenario = getTourForRole(user.role);
      if (scenario) void markTourComplete(token, scenario.tourId);
    }
  }, [user, token]);

  return { isRunning, restartTour, skipTour };
}
