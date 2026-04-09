/**
 * Phase 5-3 개선 — 범용 기능별(Feature-based) 투어 훅
 *
 * Gemini 제언 ① + ② + ③ 통합 구현:
 *   ① Intermediate Progress: PATCH /onboarding/progress 로 스텝별 서버 동기화
 *   ② Cross-Tab Sync: socket.io 'onboarding:completed' 이벤트로 타 기기 즉시 종료
 *   ③ Feature-based Tours: triggerCondition 으로 라우트 기반 자동 실행 제어
 *
 * 사용 예:
 *   const { isRunning, restartTour } = useFeatureTour('portfolio-tour',
 *     () => location.pathname === '/portfolio'
 *   );
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useAuth } from './useAuth';
import { ALL_TOURS, type TourId } from '../tours/scenarios';
import { getSharedSocket } from './useChat';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// ── API 헬퍼 ──────────────────────────────────────────────────────────────────

async function fetchOnboardingStatus(token: string): Promise<{
  completedTours: TourId[];
  progressMap: Record<string, number>;
}> {
  try {
    const res = await fetch(`${API_BASE}/onboarding/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { completedTours: [], progressMap: {} };
    return res.json() as Promise<{ completedTours: TourId[]; progressMap: Record<string, number> }>;
  } catch {
    return { completedTours: [], progressMap: {} };
  }
}

async function patchProgress(token: string, tourId: TourId, lastStepIndex: number): Promise<void> {
  try {
    await fetch(`${API_BASE}/onboarding/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tourId, lastStepIndex }),
    });
  } catch {
    // 진행 동기화 실패는 UX를 차단하지 않음
  }
}

async function markComplete(token: string, tourId: TourId): Promise<void> {
  try {
    await fetch(`${API_BASE}/onboarding/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tourId }),
    });
  } catch {
    // 완료 기록 실패는 UX를 차단하지 않음
  }
}

// ── 훅 인터페이스 ─────────────────────────────────────────────────────────────

export interface UseFeatureTourReturn {
  /** 현재 투어가 실행 중인지 여부 */
  isRunning: boolean;
  /** 마지막으로 완료된 스텝 인덱스 (-1: 시작 전) */
  currentStep: number;
  /** 투어를 처음부터 다시 시작합니다 */
  restartTour: () => void;
  /** 투어를 건너뛰고 완료 처리합니다 */
  skipTour: () => void;
}

// ── 훅 구현 ──────────────────────────────────────────────────────────────────

/**
 * @param tourId 실행할 투어의 ID
 * @param triggerCondition 자동 실행 조건 함수 (undefined 이면 항상 실행 가능)
 */
export function useFeatureTour(
  tourId: TourId,
  triggerCondition?: () => boolean,
): UseFeatureTourReturn {
  const { user, token } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const hasTriggeredRef = useRef(false);
  // triggerCondition 은 매 렌더마다 새 함수가 전달될 수 있으므로 ref 에 보관
  const triggerConditionRef = useRef(triggerCondition);
  useEffect(() => {
    triggerConditionRef.current = triggerCondition;
  });

  const scenario = ALL_TOURS.find((t) => t.tourId === tourId);

  const startTour = useCallback(
    (resumeFromStep = 0) => {
      if (!user || !token || !scenario) return;

      const startIndex = Math.max(0, Math.min(resumeFromStep, scenario.steps.length - 1));

      // 첫 스텝 대상 요소가 아직 DOM 에 없으면 실행 취소
      const firstElId = scenario.steps[startIndex]?.element?.toString().replace(/^#/, '') ?? '';
      if (firstElId && !document.getElementById(firstElId)) return;

      setIsRunning(true);
      setCurrentStep(startIndex);

      const driverObj = driver({
        showProgress: true,
        progressText: '{{current}} / {{total}}',
        nextBtnText: '다음 ›',
        prevBtnText: '‹ 이전',
        doneBtnText: '시작하기 🚀',
        steps: scenario.steps,
        // ① 스텝 진입마다 서버에 진행 상태 동기화
        onHighlightStarted: (_el, _step, opts) => {
          const idx = (opts as { state?: { activeIndex?: number } }).state?.activeIndex ?? 0;
          setCurrentStep(idx);
          void patchProgress(token, tourId, idx);
        },
        // 투어 종료(완료/닫기) 시 완료 기록
        onDestroyed: () => {
          setIsRunning(false);
          void markComplete(token, tourId);
        },
      });

      driverRef.current = driverObj;
      driverObj.drive(startIndex);
    },
    [user, token, scenario, tourId],
  );

  // ── 자동 실행 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !token || hasTriggeredRef.current) return;
    if (triggerConditionRef.current && !triggerConditionRef.current()) return;
    if (!scenario) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void fetchOnboardingStatus(token).then(({ completedTours, progressMap }) => {
      if (cancelled) return;
      if (completedTours.includes(tourId)) return;

      hasTriggeredRef.current = true;
      // ① 이전 진행 척도로 이어서 시작
      const resumeStep = progressMap[tourId] ?? 0;
      timer = setTimeout(() => startTour(resumeStep), 800);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, token, tourId, scenario, startTour]);

  // ── ② Cross-Tab Sync: 소켓 이벤트로 타 기기 투어 즉시 종료 ──────────────
  useEffect(() => {
    if (!token) return;

    const socket = getSharedSocket(token);
    const handler = (data: { tourId: TourId }) => {
      if (data.tourId === tourId) {
        driverRef.current?.destroy();
        setIsRunning(false);
      }
    };

    socket.on('onboarding:completed', handler);
    return () => {
      socket.off('onboarding:completed', handler);
    };
  }, [token, tourId]);

  const restartTour = useCallback(() => {
    hasTriggeredRef.current = false;
    driverRef.current?.destroy();
    startTour(0);
  }, [startTour]);

  const skipTour = useCallback(() => {
    driverRef.current?.destroy();
    setIsRunning(false);
    if (token) void markComplete(token, tourId);
  }, [token, tourId]);

  return { isRunning, currentStep, restartTour, skipTour };
}
