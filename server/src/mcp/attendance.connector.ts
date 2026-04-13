/**
 * 출결 시스템 Read-only 커넥터 (plan.md 1-3)
 *
 * 외부 출결 시스템에서 날짜 범위 기준 출결 기록을 읽고,
 * OpenMento DB의 attendance_logs 테이블에 동기화합니다.
 *
 * Write 금지 원칙 (plan.md 부록 B):
 *   출결 원천 데이터는 외부 시스템에서만 변경. OpenMento은 Read-only 동기화만 수행합니다.
 */

import type {
  IAttendanceConnector,
  ConnectorConfig,
  AttendanceRecord,
} from './connector.interface.js';
import { connectorFetch } from './connector-fetch.js';

// ── 출결 API 응답 타입 ──────────────────────────────────────────────────
interface AttendanceApiResponse {
  studentId: string;
  courseId: string;
  date: string;   // YYYY-MM-DD
  status: 'present' | 'absent' | 'late' | 'excused';
}

// ── 출결 커넥터 구현 ─────────────────────────────────────────────────────
export class AttendanceConnector implements IAttendanceConnector {
  readonly slug: string;
  readonly institutionId: string;
  private readonly config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.slug = config.slug;
    this.institutionId = config.institutionId;
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await connectorFetch<unknown>(
        `${this.config.baseUrl}/health`,
        this.config.auth,
        { timeoutMs: this.config.timeoutMs },
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  /**
   * 날짜 범위 출결 기록 조회
   * GET /api/attendance[?courseId=...&from=...&to=...&studentId=...]
   */
  async getAttendanceRecords(
    courseId: string,
    from: string,
    to: string,
    studentId?: string,
  ): Promise<AttendanceRecord[]> {
    const params = new URLSearchParams({
      courseId,
      from,
      to,
      ...(studentId ? { studentId } : {}),
    });

    const url = `${this.config.baseUrl}/api/attendance?${params.toString()}`;

    const raw = await connectorFetch<AttendanceApiResponse[]>(
      url,
      this.config.auth,
      { timeoutMs: this.config.timeoutMs },
    );

    return raw.map((item) => ({
      studentId: item.studentId,
      courseId: item.courseId,
      date: item.date,
      status: item.status,
    }));
  }
}
