/**
 * MCP 커넥터 레지스트리 (plan.md 1-3)
 *
 * 기관(institutionId)별 커넥터 인스턴스를 생성·관리합니다.
 * 커넥터 설정(baseUrl, auth)은 DB 또는 환경변수에서 읽어오며,
 * Phase 1에서는 환경변수 기반, Phase 2 이후에는 DB 기반으로 전환합니다.
 *
 * 사용 방법:
 *   const lms = ConnectorRegistry.getLms(institutionId);
 *   const attendance = ConnectorRegistry.getAttendance(institutionId);
 */

import type { ConnectorConfig } from './connector.interface.js';
import { LmsConnector } from './lms.connector.js';
import { AttendanceConnector } from './attendance.connector.js';

// ── 환경변수 기반 커넥터 설정 빌더 ──────────────────────────────────────
// Phase 2 이후: DB의 connectors 테이블로 교체 예정 (admin GUI 연동)
function buildLmsConfig(institutionId: string): ConnectorConfig | null {
  const baseUrl = process.env.LMS_BASE_URL;
  const apiKey = process.env.LMS_API_KEY;

  if (!baseUrl || !apiKey) return null;

  return {
    slug: 'lms-default',
    baseUrl,
    auth: { kind: 'api_key', headerName: 'X-API-Key', apiKey },
    institutionId,
    timeoutMs: 10_000,
  };
}

function buildAttendanceConfig(institutionId: string): ConnectorConfig | null {
  const baseUrl = process.env.ATTENDANCE_BASE_URL;
  const apiKey = process.env.ATTENDANCE_API_KEY;

  if (!baseUrl || !apiKey) return null;

  return {
    slug: 'attendance-default',
    baseUrl,
    auth: { kind: 'api_key', headerName: 'X-API-Key', apiKey },
    institutionId,
    timeoutMs: 10_000,
  };
}

// ── 커넥터 인스턴스 캐시 ──────────────────────────────────────────────────
const lmsCache = new Map<string, LmsConnector>();
const attendanceCache = new Map<string, AttendanceConnector>();

export const ConnectorRegistry = {
  /**
   * 기관별 LMS 커넥터 반환. 환경변수 미설정 시 null 반환.
   */
  getLms(institutionId: string): LmsConnector | null {
    if (lmsCache.has(institutionId)) return lmsCache.get(institutionId)!;

    const config = buildLmsConfig(institutionId);
    if (!config) return null;

    const connector = new LmsConnector(config);
    lmsCache.set(institutionId, connector);
    return connector;
  },

  /**
   * 기관별 출결 커넥터 반환. 환경변수 미설정 시 null 반환.
   */
  getAttendance(institutionId: string): AttendanceConnector | null {
    if (attendanceCache.has(institutionId)) return attendanceCache.get(institutionId)!;

    const config = buildAttendanceConfig(institutionId);
    if (!config) return null;

    const connector = new AttendanceConnector(config);
    attendanceCache.set(institutionId, connector);
    return connector;
  },

  /**
   * 설정 변경 시(Phase 2 DB 연동 이후) 캐시를 무효화합니다.
   */
  invalidate(institutionId: string): void {
    lmsCache.delete(institutionId);
    attendanceCache.delete(institutionId);
  },
};
