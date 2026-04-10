/**
 * tenant-repository.ts — Tenant Repository 기반 계층
 *
 * Phase 5-2 ② 트랜잭션 이탈(Context Escape) 방지 아키텍처
 *
 * 원칙:
 *   라우터(routes/)는 절대로 `db` 객체를 직접 import하지 않습니다.
 *   모든 DB 접근은 이 TenantRepository 또는 그 하위 Repository를 통해서만 수행됩니다.
 *
 *   라우터 → Repository.method(institutionId, ...) → withTenantContext → DB
 *
 * 장점:
 *   1. `withTenantContext`를 누락할 수 없는 구조적 강제
 *   2. RLS 미설정으로 인한 크로스 테넌트 데이터 노출 원천 차단
 *   3. unit test 시 Repository 인터페이스 단위로 모킹 가능
 *
 * 사용 예시:
 *   import { StudentRepository } from '../repositories/tenant-repository.js';
 *   const repo = new StudentRepository();
 *   const list = await repo.list(req.user.institutionId);
 */

import { withTenantContext } from '@openmento/db';
import {
  db,
  students,
  ewsRiskScores,
  auditLogs,
  heartbeatRuns,
  eq,
  desc,
  and,
  isNull,
  sql,
} from '@openmento/db';

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── 기반 클래스 ───────────────────────────────────────────────────────────────

/**
 * 모든 Tenant Repository의 기반 클래스.
 * `withTenant()` 메서드로 안전하게 컨텍스트를 감쌀 수 있습니다.
 */
export abstract class TenantRepository {
  /**
   * withTenantContext 래퍼 — 모든 하위 Repository의 DB 접근은 이를 통해야 합니다.
   */
  protected withTenant<T>(
    institutionId: string,
    callback: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    return withTenantContext(institutionId, callback);
  }
}

// ── StudentRepository ─────────────────────────────────────────────────────────

export class StudentRepository extends TenantRepository {
  /** 기관의 활성 수강생 목록 (soft-delete 제외) */
  async list(institutionId: string, courseId?: string) {
    return this.withTenant(institutionId, async (tx) => {
      const conditions = [
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
        ...(courseId ? [eq(students.courseId, courseId)] : []),
      ];
      return tx
        .select()
        .from(students)
        .where(and(...conditions))
        .orderBy(desc(students.enrolledAt));
    });
  }

  /** 수강생 단건 조회 — 없으면 null 반환 (RLS로 다른 기관 데이터는 null 처리) */
  async findById(institutionId: string, studentId: string) {
    return this.withTenant(institutionId, async (tx) => {
      const rows = await tx
        .select()
        .from(students)
        .where(and(eq(students.id, studentId), isNull(students.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
    });
  }
}

// ── EwsRiskScoreRepository ────────────────────────────────────────────────────

export class EwsRiskScoreRepository extends TenantRepository {
  /** 기관의 고위험 수강생 목록 (점수 내림차순) */
  async listHighRisk(institutionId: string, minScore: number) {
    return this.withTenant(institutionId, async (tx) => {
      return tx
        .select()
        .from(ewsRiskScores)
        .where(
          and(
            eq(ewsRiskScores.institutionId, institutionId),
            sql`${ewsRiskScores.totalScore} >= ${minScore}`,
          ),
        )
        .orderBy(desc(ewsRiskScores.totalScore));
    });
  }

  /** 수강생의 최신 위험 점수 단건 조회 */
  async latestByStudent(institutionId: string, studentId: string) {
    return this.withTenant(institutionId, async (tx) => {
      const rows = await tx
        .select()
        .from(ewsRiskScores)
        .where(eq(ewsRiskScores.studentId, studentId))
        .orderBy(desc(ewsRiskScores.calculatedAt))
        .limit(1);
      return rows[0] ?? null;
    });
  }
}

// ── AuditLogRepository ────────────────────────────────────────────────────────

export class AuditLogRepository extends TenantRepository {
  /** 기관의 최근 감사 로그 */
  async recent(institutionId: string, limit = 100) {
    return this.withTenant(institutionId, async (tx) => {
      return tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.institutionId, institutionId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
    });
  }

  /** 액션 유형별 필터 */
  async byAction(institutionId: string, action: (typeof auditLogs.$inferSelect)['action']) {
    return this.withTenant(institutionId, async (tx) => {
      return tx
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.institutionId, institutionId), eq(auditLogs.action, action)),
        )
        .orderBy(desc(auditLogs.createdAt));
    });
  }
}

// ── HeartbeatRunRepository ────────────────────────────────────────────────────

export class HeartbeatRunRepository extends TenantRepository {
  /** 기관의 최근 실행 이력 */
  async recent(institutionId: string, limit = 50) {
    return this.withTenant(institutionId, async (tx) => {
      return tx
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.institutionId, institutionId))
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(limit);
    });
  }

  /** 현재 실행 중이거나 대기 중인 Job */
  async activeJobs(institutionId: string) {
    return this.withTenant(institutionId, async (tx) => {
      return tx
        .select()
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.institutionId, institutionId),
            sql`${heartbeatRuns.status} IN ('queued', 'wakeup', 'running')`,
          ),
        );
    });
  }
}
