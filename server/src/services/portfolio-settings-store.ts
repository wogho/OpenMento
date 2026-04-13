/**
 * 포트폴리오 설정 공유 스토어 (기관별, Write-Through DB 캐시)
 *
 * Phase 5 진입 전 개선: in-memory 전용 → institution_settings 테이블 영속화로 전환.
 * admin.ts (PUT /admin/portfolio-settings) 에서 쓰고,
 * portfolio.ts (POST /portfolio/analyze) 에서 읽는다.
 *
 * DB 미연결(테스트/offline) 시 인메모리 전용으로 안전하게 동작합니다.
 */

import {
  getInstitutionSetting,
  setInstitutionSetting,
  _resetInstitutionSettingsForTest as _resetBase,
} from './institution-settings-service.js';

export interface PortfolioSettings {
  /** 유사도 위험 임계치 (0–100 정수). 이상이면 "차별화 필수" */
  criticalThreshold: number;
  /** 유사도 주의 임계치 (0–100 정수). 이상이면 "개선 권장" */
  warningThreshold: number;
  defaultFeedbackStyle: 'direct' | 'socratic';
  compareScope: 'current_cohort' | 'all';
}

const DEFAULT_SETTINGS: PortfolioSettings = {
  criticalThreshold: 85,
  warningThreshold: 60,
  defaultFeedbackStyle: 'direct',
  compareScope: 'all',
};

const SETTING_KEY = 'portfolio';

/** 기관 설정 조회 — DB Write-Through 캐시 사용 (없으면 기본값 반환) */
export async function getPortfolioSettings(institutionId: string): Promise<PortfolioSettings> {
  return getInstitutionSetting<PortfolioSettings>(institutionId, SETTING_KEY, DEFAULT_SETTINGS);
}

/** 기관 설정 저장 — DB UPSERT + 캐시 갱신 */
export async function setPortfolioSettings(
  institutionId: string,
  settings: PortfolioSettings,
): Promise<void> {
  return setInstitutionSetting<PortfolioSettings>(institutionId, SETTING_KEY, settings);
}

/** 테스트용 초기화 */
export function _resetPortfolioSettingsForTest(): void {
  _resetBase();
}

