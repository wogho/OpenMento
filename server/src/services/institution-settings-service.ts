/**
 * institution-settings-service.ts — 기관별 범용 설정 Write-Through 캐시 서비스
 *
 * EWS 임계치(ews-thresholds.ts)와 동일한 Write-Through 패턴을 사용합니다:
 *   - GET: 캐시 HIT → 즉시 반환 / MISS → DB 조회 → 캐시 적재
 *   - SET: DB UPSERT → 캐시 갱신
 *   - 서버 기동 시 loadAllInstitutionSettings() 프리워밍
 *   - DB 접근 불가 시 기본값 폴백으로 서버 기동 중단 없이 동작
 */

import type { Db } from '@educlip/db';
import { institutionSettings } from '@educlip/db/schema';
import { and, eq } from '@educlip/db';

// ── 인메모리 캐시 ────────────────────────────────────────────────────────────
// key: `${institutionId}:${settingKey}`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new Map<string, Record<string, any>>();

let _db: Db | null = null;

/** DB 인스턴스 주입 — 서버 기동 시 한 번 호출. 미주입 시 인메모리 전용으로 동작 */
export function initInstitutionSettingsDb(db: Db): void {
  _db = db;
}

function cacheKey(institutionId: string, settingKey: string): string {
  return `${institutionId}:${settingKey}`;
}

/**
 * 기관 설정 조회 — 캐시 우선, 없으면 DB, 없으면 defaultValue 반환
 */
export async function getInstitutionSetting<T extends object>(
  institutionId: string,
  settingKey: string,
  defaultValue: T,
): Promise<T> {
  const ck = cacheKey(institutionId, settingKey);
  const cached = cache.get(ck);
  if (cached !== undefined) return cached as T;

  if (!_db) return { ...defaultValue };

  try {
    const rows = await _db
      .select({ settingValue: institutionSettings.settingValue })
      .from(institutionSettings)
      .where(
        and(
          eq(institutionSettings.institutionId, institutionId),
          eq(institutionSettings.settingKey, settingKey),
        ),
      )
      .limit(1);

    if (rows.length === 0) return { ...defaultValue };
    const value = rows[0].settingValue as T;
    cache.set(ck, value);
    return value;
  } catch {
    return { ...defaultValue };
  }
}

/**
 * 기관 설정 저장 — DB UPSERT 후 캐시 갱신
 */
export async function setInstitutionSetting<T extends object>(
  institutionId: string,
  settingKey: string,
  value: T,
): Promise<void> {
  const ck = cacheKey(institutionId, settingKey);
  cache.set(ck, value);

  if (!_db) return;

  try {
    await _db
      .insert(institutionSettings)
      .values({
        institutionId,
        settingKey,
        settingValue: value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [institutionSettings.institutionId, institutionSettings.settingKey],
        set: { settingValue: value, updatedAt: new Date() },
      });
  } catch (err) {
    // 쓰기 실패 시에도 인메모리 캐시는 최신 상태로 유지됩니다 (read 일관성 보장)
    console.error('[institution-settings] DB 쓰기 실패:', err);
  }
}

/**
 * 서버 기동 시 모든 기관 설정을 DB에서 캐시로 프리워밍
 */
export async function loadAllInstitutionSettings(): Promise<void> {
  if (!_db) return;

  try {
    const rows = await _db
      .select({
        institutionId: institutionSettings.institutionId,
        settingKey: institutionSettings.settingKey,
        settingValue: institutionSettings.settingValue,
      })
      .from(institutionSettings);

    for (const row of rows) {
      cache.set(cacheKey(row.institutionId, row.settingKey), row.settingValue);
    }
  } catch (err) {
    console.error('[institution-settings] DB 프리워밍 실패 — 기본값으로 동작합니다:', err);
  }
}

/** 테스트용 캐시 초기화 */
export function _resetInstitutionSettingsForTest(): void {
  cache.clear();
  _db = null;
}
