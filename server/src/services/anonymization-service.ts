/**
 * anonymization-service.ts — 개인정보 익명화 유틸리티 (Phase 5-5)
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────────
 *
 *   수강생 실명(displayName)과 익명 ID(anonymousId)의 분리를 보장하고,
 *   PII(개인식별정보) 노출 여부를 감사·리포트합니다.
 *
 *   ① anonymizeDisplayName(name)          — 이름을 마스킹 형태로 변환 (홍*동)
 *   ② redactStudent(student)              — AI/EWS 로직 전달 전 PII 제거
 *   ③ auditPiiExposure(institutionId)     — 기관의 PII 노출 위험 지표 집계
 *
 * ── 분리 원칙 ────────────────────────────────────────────────────────────────
 *
 *   - 모든 AI 에이전트(EWS·튜터·포트폴리오)는 anonymousId만 다룹니다.
 *   - displayName은 강사·관리자 UI에서만 마스킹 형태로 표시됩니다.
 *   - DB에 저장될 때 displayName은 마스킹 표시용 값으로만 저장합니다.
 *     (원본 실명은 수료증 발급 등 본인 인증 연계 시스템에서만 관리)
 */

import {
  db,
  students,
  counselingNotes,
  conversationMessages,
  auditLogs,
  eq,
  and,
  isNull,
  sql,
} from '@openmento/db';
import { logger } from '../utils/logger.js';

// ── 마스킹 유틸 ──────────────────────────────────────────────────────────────

/**
 * 이름을 마스킹 형태로 변환합니다.
 *
 * 예시:
 *   '홍길동' → '홍*동'
 *   '김철수' → '김*수'
 *   'John'   → 'J**n'
 *   'AB'     → 'A*'
 *   'A'      → '*'
 */
export function anonymizeDisplayName(name: string | null | undefined): string {
  if (!name || name.trim().length === 0) return '(익명)';

  const trimmed = name.trim();
  if (trimmed.length === 1) return '*';
  if (trimmed.length === 2) return `${trimmed[0]}*`;

  // 이름 앞·뒤 글자 보존, 중간 전체 마스킹
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const middle = '*'.repeat(trimmed.length - 2);
  return `${first}${middle}${last}`;
}

// ── AI 전달용 수강생 객체 정제 ────────────────────────────────────────────────

/**
 * 수강생 객체에서 PII 필드를 제거하고 AI 에이전트에 전달 가능한 안전한 형태로 반환합니다.
 *
 * AI 로직은 반드시 이 함수를 통해 가공된 객체만 받아야 합니다.
 */
export function redactStudentForAi(student: {
  id: string;
  anonymousId: string;
  institutionId: string;
  courseId: string | null;
  displayName: string | null;
  isActive: boolean;
  enrolledAt: Date;
}): {
  anonymousId: string;
  institutionId: string;
  courseId: string | null;
  isActive: boolean;
  enrolledAt: Date;
} {
  // id, displayName 제거 — AI 에이전트에 실 ID/이름 불필요
  return {
    anonymousId: student.anonymousId,
    institutionId: student.institutionId,
    courseId: student.courseId,
    isActive: student.isActive,
    enrolledAt: student.enrolledAt,
  };
}

// ── PII 노출 감사 ─────────────────────────────────────────────────────────────

export interface PiiAuditResult {
  institutionId: string;
  totalStudents: number;
  studentsWithDisplayName: number;         // 마스킹되지 않은 실명 저장 수
  studentsWithUnmaskedName: number;        // 홍*동 형태가 아닌 원본 이름 저장 수
  counselingNotesWithPii: number;          // 상담 메모 내 직접 이름 언급 패턴 수 (휴리스틱)
  conversationMessageCount: number;        // 대화 이력 건수
  auditLogCount: number;                   // 감사 로그 건수
  risks: PiiRisk[];
  checkedAt: string;
}

export interface PiiRisk {
  level: 'critical' | 'warning' | 'info';
  message: string;
  affectedCount: number;
}

/**
 * 기관의 PII 노출 위험 지표를 집계합니다.
 *
 * 이 함수는 /admin/security/audit-report 에서 호출됩니다.
 */
export async function auditPiiExposure(institutionId: string): Promise<PiiAuditResult> {
  const risks: PiiRisk[] = [];

  // ① 전체 수강생 수
  const [totalRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(students)
    .where(and(eq(students.institutionId, institutionId), isNull(students.deletedAt)));

  const totalStudents = Number(totalRow?.count ?? 0);

  // ② displayName 보유 수
  const [withNameRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(students)
    .where(
      and(
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
        sql`${students.displayName} IS NOT NULL AND ${students.displayName} != ''`,
      ),
    );
  const studentsWithDisplayName = Number(withNameRow?.count ?? 0);

  // ③ 마스킹되지 않은 이름 (마스킹 패턴 *을 포함하지 않는 이름으로 추정)
  const [unmaskedRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(students)
    .where(
      and(
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
        sql`${students.displayName} IS NOT NULL AND ${students.displayName} NOT LIKE '%*%'`,
      ),
    );
  const studentsWithUnmaskedName = Number(unmaskedRow?.count ?? 0);

  if (studentsWithUnmaskedName > 0) {
    risks.push({
      level: 'warning',
      message: `${studentsWithUnmaskedName}명의 수강생 이름이 마스킹되지 않은 형태로 저장되어 있습니다.`,
      affectedCount: studentsWithUnmaskedName,
    });
  }

  // ④ 상담 노트 건수 (PII 포함 가능성 있는 텍스트) — student.institutionId 조인
  const [counselingRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(counselingNotes)
    .innerJoin(students, eq(counselingNotes.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        isNull(counselingNotes.deletedAt),
      ),
    );
  const counselingNotesWithPii = Number(counselingRow?.count ?? 0);

  if (counselingNotesWithPii > 0) {
    risks.push({
      level: 'info',
      message: `상담 노트 ${counselingNotesWithPii}건이 존재합니다. 노트 내 실명 언급 여부를 정기 검토하십시오.`,
      affectedCount: counselingNotesWithPii,
    });
  }

  // ⑤ 대화 이력 건수 — student.institutionId 조인
  const [convRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(conversationMessages)
    .innerJoin(students, eq(conversationMessages.studentId, students.id))
    .where(eq(students.institutionId, institutionId));
  // 대화 이력은 anonymousId 기반이므로 info 수준만
  const conversationMessageCount = Number(convRow?.count ?? 0);

  // ⑥ 감사 로그 건수
  const [auditRow] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.institutionId, institutionId));
  const auditLogCount = Number(auditRow?.count ?? 0);

  if (auditLogCount === 0) {
    risks.push({
      level: 'warning',
      message: '감사 로그가 0건입니다. 에이전트 외부 접근이 기록되고 있지 않을 수 있습니다.',
      affectedCount: 0,
    });
  }

  logger.info({ institutionId, totalStudents, risks: risks.length }, '[anonymization] PII 감사 완료');

  return {
    institutionId,
    totalStudents,
    studentsWithDisplayName,
    studentsWithUnmaskedName,
    counselingNotesWithPii,
    conversationMessageCount,
    auditLogCount,
    risks,
    checkedAt: new Date().toISOString(),
  };
}
