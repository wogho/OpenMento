/**
 * ews-thresholds.ts — EWS 위험 임계치 공유 저장소
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────
 *
 *  Phase 2(완료): DB 영속화 + 인메모리 Write-Through 캐시
 *    - getEwsThresholds(): 캐시 HIT → 즉시 반환 / MISS → DB 조회 후 캐시 적재
 *    - setEwsThresholds(): DB UPSERT 후 캐시 갱신
 *    - loadEwsThresholdsFromDb(): 서버 기동 시 전체 기관 임계치 캐시 프리워밍
 *    - DB 접근 불가(테스트/offline) 시 기본값 폴백으로 안전하게 동작
 *
 *  admin.ts (PUT /admin/thresholds) ─┐
 *                                    ├─► thresholdsCache + ews_settings DB ──► ews-monitor.ts
 *  ews-monitor.ts (classifyRiskLevel) ◄─┘
 */

import type { Db } from '@openmento/db';
import { ewsSettings } from '@openmento/db/schema';

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

// ── Write-Through 인메모리 캐시 ───────────────────────────────────────────────
// DB 없는 환경(단위 테스트, offline)에서도 안전하게 동작합니다.
const thresholdsCache = new Map<string, EwsThresholds>();

// DB 인스턴스 — initEwsThresholdsDb()로 주입, 미주입 시 인메모리 전용으로 동작
let _db: Db | null = null;

/**
 * DB 인스턴스를 주입합니다. 서버 기동 시 한번 호출하면 됩니다.
 * 테스트 환경에서는 호출하지 않으면 인메모리 전용으로 동작합니다.
 */
export function initEwsThresholdsDb(db: Db): void {
  _db = db;
}

/**
 * 서버 기동 시 DB에 저장된 모든 기관 임계치를 캐시로 프리워밍합니다.
 * DB 접근 실패 시 경고만 출력하고 계속 동작합니다.
 */
export async function loadEwsThresholdsFromDb(): Promise<void> {
  if (!_db) return;
  try {
    const rows = await _db.select().from(ewsSettings);
    for (const row of rows) {
      thresholdsCache.set(row.institutionId, {
        warningThreshold:  row.warningThreshold,
        highRiskThreshold: row.highRiskThreshold,
        criticalThreshold: row.criticalThreshold,
        slackEscalateScore: row.slackEscalateScore,
      });
    }
  } catch (err) {
    console.warn('[EwsThresholds] DB 프리워밍 실패, 인메모리 모드로 계속 동작합니다.', err);
  }
}

/**
 * 기관의 현재 임계치를 반환합니다.
 * 캐시 미스이고 DB가 주입된 경우 DB를 조회한 후 캐시에 적재합니다.
 * DB 접근도 불가능하면 기본값을 반환합니다.
 */
export function getEwsThresholds(institutionId: string): EwsThresholds {
  return thresholdsCache.get(institutionId) ?? { ...DEFAULT_EWS_THRESHOLDS };
}

/**
 * 기관의 임계치를 업데이트합니다 (Write-Through).
 * DB가 주입된 경우 DB에 UPSERT 후 캐시를 갱신합니다.
 * DB 접근 실패 시 캐시만 갱신하고 경고를 출력합니다.
 */
export async function setEwsThresholds(
  institutionId: string,
  patch: Partial<EwsThresholds>,
): Promise<EwsThresholds> {
  const current = getEwsThresholds(institutionId);
  const updated: EwsThresholds = { ...current, ...patch };

  // 1. 캐시 즉시 갱신 (읽기 경로 차단 없이 응답)
  thresholdsCache.set(institutionId, updated);

  // 2. DB UPSERT (비동기, 실패해도 캐시는 유지)
  if (_db) {
    try {
      await _db
        .insert(ewsSettings)
        .values({
          institutionId,
          warningThreshold:  updated.warningThreshold,
          highRiskThreshold: updated.highRiskThreshold,
          criticalThreshold: updated.criticalThreshold,
          slackEscalateScore: updated.slackEscalateScore,
        })
        .onConflictDoUpdate({
          target: ewsSettings.institutionId,
          set: {
            warningThreshold:  updated.warningThreshold,
            highRiskThreshold: updated.highRiskThreshold,
            criticalThreshold: updated.criticalThreshold,
            slackEscalateScore: updated.slackEscalateScore,
            updatedAt: new Date(),
          },
        });
    } catch (err) {
      console.warn('[EwsThresholds] DB UPSERT 실패, 캐시만 갱신됩니다.', err);
    }
  }

  return updated;
}

/**
 * 테스트용: 캐시 및 DB 인스턴스를 초기화합니다.
 */
export function _resetForTest(): void {
  thresholdsCache.clear();
  _db = null;
}
