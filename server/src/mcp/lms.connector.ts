/**
 * LMS Read-only 커넥터 (plan.md 1-3)
 *
 * 강의 진도, 수강 시간, 퀴즈 점수를 외부 LMS API에서 읽어옵니다.
 *
 * 지원 외부 시스템:
 *   - Generic REST API (기본) — baseUrl + 표준 응답 규약
 *
 * 기본 Write 금지 원칙 (plan.md 부록 B):
 *   LMS 데이터는 Read-only. 쓰기 작업은 이 커넥터에 구현하지 않습니다.
 */

import type {
  ILmsConnector,
  ConnectorConfig,
  LmsCourseProgress,
  LmsQuizScore,
} from './connector.interface.js';
import { connectorFetch } from './connector-fetch.js';

// ── LMS API 응답 타입 (외부 시스템 규약) ────────────────────────────────
// Generic REST LMS 응답 구조에 맞춰 정의합니다.
// 실제 도입 시 LMS 벤더별로 이 타입과 URL 경로를 조정합니다.
interface LmsProgressApiResponse {
  studentId: string;
  courseId: string;
  progressPercent: number;
  lastAccessedAt: string;
  totalStudyMinutes: number;
}

interface LmsQuizApiResponse {
  studentId: string;
  quizId: string;
  quizTitle: string;
  score: number;
  maxScore: number;
  takenAt: string;
}

// ── LMS 커넥터 구현 ───────────────────────────────────────────────────────
export class LmsConnector implements ILmsConnector {
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
   * 강의 진도 조회
   * GET /api/courses/{courseId}/progress[?studentId=...]
   */
  async getCourseProgress(courseId: string, studentId?: string): Promise<LmsCourseProgress[]> {
    const params = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
    const url = `${this.config.baseUrl}/api/courses/${encodeURIComponent(courseId)}/progress${params}`;

    const raw = await connectorFetch<LmsProgressApiResponse[]>(
      url,
      this.config.auth,
      { timeoutMs: this.config.timeoutMs },
    );

    return raw.map((item) => ({
      studentId: item.studentId,
      courseId: item.courseId,
      progressPercent: item.progressPercent,
      lastAccessedAt: item.lastAccessedAt,
      totalStudyMinutes: item.totalStudyMinutes,
    }));
  }

  /**
   * 퀴즈 점수 조회
   * GET /api/courses/{courseId}/quizzes[?studentId=...]
   */
  async getQuizScores(courseId: string, studentId?: string): Promise<LmsQuizScore[]> {
    const params = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';
    const url = `${this.config.baseUrl}/api/courses/${encodeURIComponent(courseId)}/quizzes${params}`;

    const raw = await connectorFetch<LmsQuizApiResponse[]>(
      url,
      this.config.auth,
      { timeoutMs: this.config.timeoutMs },
    );

    return raw.map((item) => ({
      studentId: item.studentId,
      quizId: item.quizId,
      quizTitle: item.quizTitle,
      score: item.score,
      maxScore: item.maxScore,
      takenAt: item.takenAt,
    }));
  }
}
