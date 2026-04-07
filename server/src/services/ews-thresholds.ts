/**
 * ews-thresholds.ts — EWS 위험 임계치 공유 저장소
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────
 *
 *  Phase 2: 프로세스 내 인메모리 Map으로 기관별 임계치 관리
 *  Phase 3: DB 기반 기관별 설정으로 전환 예정
 *
 *  admin.ts (PUT /admin/thresholds) ─┐
 *                                    ├─► thresholdsStore ──► ews-monitor.ts
 *  ews-monitor.ts (classifyRiskLevel) ◄─┘
 *
 * 이 모듈을 양쪽에서 임포트하여 임계치 변경이 즉시 EWS 로직에 반영됩니다.
 */

export interface EwsThresholds {
  /** 위험 판정 기준 (warning, 기본 60) */
  warningThreshold: number;
  /** 고위험 판정 기준 (high_risk, 기본 75) */
  highRiskThreshold: number;
  /** 긴급 판정 기준 (critical, 기본 90) */
  criticalThreshold: number;
  /** Slack 에스컬레이션 트리거 점수 (기본 75) */
  slackEscalateScore: number;
}

export const DEFAULT_EWS_THRESHOLDS: EwsThresholds = {
  warningThreshold:  60,
  highRiskThreshold: 75,
  criticalThreshold: 90,
  slackEscalateScore: 75,
};

/** 기관 ID → 임계치 인메모리 저장소 */
const thresholdsStore = new Map<string, EwsThresholds>();

/**
 * 기관의 현재 임계치를 반환합니다. 설정이 없으면 기본값을 반환합니다.
 */
export function getEwsThresholds(institutionId: string): EwsThresholds {
  return thresholdsStore.get(institutionId) ?? { ...DEFAULT_EWS_THRESHOLDS };
}

/**
 * 기관의 임계치를 업데이트합니다.
 * 제공된 필드만 덮어쓰고 나머지는 기존값을 유지합니다.
 */
export function setEwsThresholds(
  institutionId: string,
  patch: Partial<EwsThresholds>,
): EwsThresholds {
  const current = getEwsThresholds(institutionId);
  const updated: EwsThresholds = { ...current, ...patch };
  thresholdsStore.set(institutionId, updated);
  return updated;
}
