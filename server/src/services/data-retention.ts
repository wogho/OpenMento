/**
 * data-retention.ts — 5년 데이터 보존 후 개인정보 자동 삭제 서비스 (Phase 5-5)
 *
 * ── 법적 근거 ──────────────────────────────────────────────────────────────────
 *
 *   교육부 지침 및 개인정보보호법 제21조:
 *   - 교육기관은 수강생 개인정보를 수료(탈퇴) 후 5년간 보존해야 합니다.
 *   - 5년 경과 후에는 해당 개인정보를 지체 없이 파기해야 합니다.
 *   - 통계 목적 데이터(익명화된 EWS 점수, 이수율 등)는 삭제 제외입니다.
 *
 * ── 실행 스케줄 ────────────────────────────────────────────────────────────────
 *
 *   Heartbeat 에이전트 역할 `data_retention`에 연결됩니다.
 *   권장 cron 표현식: 0 3 1 1 * (매년 1월 1일 오전 3시)
 *   - DB routines 테이블에 `data_retention` 루틴을 시드하면 자동 실행됩니다.
 *
 * ── 삭제 대상 (5년 경과 soft-delete 수강생 기준) ─────────────────────────────────
 *
 *   ①  students.displayName          → NULL (이름 파기)
 *   ②  counseling_notes rows          → 영구 삭제 (hard delete)
 *   ③  conversation_messages rows     → 영구 삭제 (대화 이력)
 *   ④  assignment_submissions rows    → 영구 삭제 (제출 내용)
 *   ⑤  portfolio_projects.proposalText → NULL (기획서 내용 파기)
 *   ⑥  portfolio_projects.embedding   → NULL (개인 임베딩 벡터 파기)
 *
 * ── 보존 대상 (통계·익명 데이터) ────────────────────────────────────────────────
 *
 *   - students.anonymousId, students.enrolledAt, students.isActive (수료 통계 기반)
 *   - ews_risk_scores (기관 수준 집계 통계용)
 *   - heartbeat_runs (시스템 운영 이력)
 *   - audit_logs (감사 추적 — 5년 보존 의무)
 *
 * ── 실행 보호 ─────────────────────────────────────────────────────────────────
 *
 *   - DRY_RUN 모드: NODE_ENV=test 또는 DATA_RETENTION_DRY_RUN=true 시 실제 삭제 없이
 *     영향을 받을 행 수만 리포트합니다.
 *   - 트랜잭션: 단계별 삭제가 하나의 트랜잭션으로 묶여 있어 중단 시 롤백됩니다.
 */

import {
  db,
  students,
  counselingNotes,
  conversationMessages,
  assignmentSubmissions,
  portfolioProjects,
  and,
  sql,
  lt,
  isNotNull,
  inArray,
} from '@openmento/db';
import { logger } from '../utils/logger.js';

// ── 5년 보존 기한 상수 ────────────────────────────────────────────────────────

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;

// ── DRY RUN 모드 ─────────────────────────────────────────────────────────────

function isDryRun(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.DATA_RETENTION_DRY_RUN === 'true'
  );
}

// ── 결과 타입 ──────────────────────────────────────────────────────────────────

export interface DataRetentionResult {
  /** 5년 초과 soft-deleted 수강생 수 */
  scannedStudents: number;
  /** 실제 처리된 수강생 수 */
  processedStudents: number;
  /** 삭제된 상담 노트 수 */
  deletedCounselingNotes: number;
  /** 삭제된 대화 메시지 수 */
  deletedConversationMessages: number;
  /** 삭제된 과제 제출 수 */
  deletedAssignmentSubmissions: number;
  /** 기획서 내용을 NULL로 처리한 포트폴리오 수 */
  nulledPortfolioProposals: number;
  /** 오류 목록 */
  errors: string[];
  /** DRY RUN 여부 */
  dryRun: boolean;
  /** 실행 일시 */
  executedAt: string;
}

// ── 메인 데이터 보존 함수 ─────────────────────────────────────────────────────

/**
 * 교육부 지침에 따른 5년 경과 개인정보 자동 삭제를 수행합니다.
 *
 * Heartbeat 에이전트 역할 `data_retention`에서 호출됩니다.
 * 단독 실행: `NODE_PATH=… tsx server/src/services/data-retention.ts`
 */
export async function runDataRetention(): Promise<DataRetentionResult> {
  const result: DataRetentionResult = {
    scannedStudents: 0,
    processedStudents: 0,
    deletedCounselingNotes: 0,
    deletedConversationMessages: 0,
    deletedAssignmentSubmissions: 0,
    nulledPortfolioProposals: 0,
    errors: [],
    dryRun: isDryRun(),
    executedAt: new Date().toISOString(),
  };

  const retentionThreshold = new Date(Date.now() - FIVE_YEARS_MS);

  logger.info(
    { retentionThreshold, dryRun: result.dryRun },
    '[data-retention] 5년 데이터 보존 작업 시작',
  );

  // ── ① 5년 초과 soft-deleted 수강생 조회 ────────────────────────────────────
  const expiredStudents = await db
    .select({ id: students.id, anonymousId: students.anonymousId })
    .from(students)
    .where(
      and(
        isNotNull(students.deletedAt),
        lt(students.deletedAt, retentionThreshold),
      ),
    );

  result.scannedStudents = expiredStudents.length;

  if (expiredStudents.length === 0) {
    logger.info('[data-retention] 5년 경과 수강생 없음 — 작업 완료');
    return result;
  }

  logger.info(
    { count: expiredStudents.length },
    '[data-retention] 5년 경과 수강생 발견, 개인정보 파기 시작',
  );

  const studentIds = expiredStudents.map((s) => s.id);

  if (result.dryRun) {
    // DRY RUN: 삭제 예상 건수만 계산하고 실제 삭제하지 않습니다.
    await countDryRunImpact(studentIds, result);
    logger.info({ result }, '[data-retention] DRY RUN 완료 — 실제 삭제 없음');
    return result;
  }

  // ── ② 트랜잭션 내 순서대로 파기 ─────────────────────────────────────────────
  try {
    await db.transaction(async (tx) => {
      // ② 상담 노트 영구 삭제
      const cnResult = await tx
        .delete(counselingNotes)
        .where(inArray(counselingNotes.studentId, studentIds))
        .returning({ id: counselingNotes.id });
      result.deletedCounselingNotes = cnResult.length;

      // ③ 대화 이력 영구 삭제
      const cmResult = await tx
        .delete(conversationMessages)
        .where(inArray(conversationMessages.studentId, studentIds))
        .returning({ id: conversationMessages.id });
      result.deletedConversationMessages = cmResult.length;

      // ④ 과제 제출 영구 삭제
      const asResult = await tx
        .delete(assignmentSubmissions)
        .where(inArray(assignmentSubmissions.studentId, studentIds))
        .returning({ id: assignmentSubmissions.id });
      result.deletedAssignmentSubmissions = asResult.length;

      // ⑤ 포트폴리오 기획서 텍스트 + 임베딩 벡터 NULL 처리 (행 자체는 통계 목적 보존)
      const ppResult = await tx
        .update(portfolioProjects)
        .set({
          proposalText: null,
          embedding: null,
          updatedAt: new Date(),
        })
        .where(inArray(portfolioProjects.studentId, studentIds))
        .returning({ id: portfolioProjects.id });
      result.nulledPortfolioProposals = ppResult.length;

      // ① 수강생 이름 NULL 처리 (anonymousId·통계 컬럼은 보존)
      await tx
        .update(students)
        .set({ displayName: null, updatedAt: new Date() })
        .where(inArray(students.id, studentIds));

      result.processedStudents = studentIds.length;
    });

    // 감사 로그 기록 (트랜잭션 외부 — 실패해도 파기 결과에 영향 없음)
    await recordRetentionAudit(result, retentionThreshold);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`transaction error: ${message}`);
    logger.error({ err }, '[data-retention] 트랜잭션 실패');
  }

  logger.info(
    {
      scanned: result.scannedStudents,
      processed: result.processedStudents,
      counseling: result.deletedCounselingNotes,
      conversations: result.deletedConversationMessages,
      submissions: result.deletedAssignmentSubmissions,
      portfolios: result.nulledPortfolioProposals,
      errors: result.errors.length,
    },
    '[data-retention] 5년 데이터 보존 작업 완료',
  );

  return result;
}

// ── DRY RUN 영향 계산 ─────────────────────────────────────────────────────────

async function countDryRunImpact(
  studentIds: string[],
  result: DataRetentionResult,
): Promise<void> {
  const [cnCount] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(counselingNotes)
    .where(inArray(counselingNotes.studentId, studentIds));
  result.deletedCounselingNotes = Number(cnCount?.count ?? 0);

  const [cmCount] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(conversationMessages)
    .where(inArray(conversationMessages.studentId, studentIds));
  result.deletedConversationMessages = Number(cmCount?.count ?? 0);

  const [asCount] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(assignmentSubmissions)
    .where(inArray(assignmentSubmissions.studentId, studentIds));
  result.deletedAssignmentSubmissions = Number(asCount?.count ?? 0);

  const [ppCount] = await db
    .select({ count: sql<string>`count(*)::int` })
    .from(portfolioProjects)
    .where(inArray(portfolioProjects.studentId, studentIds));
  result.nulledPortfolioProposals = Number(ppCount?.count ?? 0);

  result.processedStudents = studentIds.length;
}

// ── 감사 로그 기록 ────────────────────────────────────────────────────────────

async function recordRetentionAudit(
  result: DataRetentionResult,
  retentionThreshold: Date,
): Promise<void> {
  try {
    // 시스템 자동 파기 액션 — audit_logs.action='delete' + actorType='system' 기록
    await db.execute(sql`
      INSERT INTO audit_logs (
        id, institution_id, actor_id, actor_type,
        action, resource_type, resource_id,
        metadata, created_at
      ) VALUES (
        gen_random_uuid(),
        NULL,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'system',
        'delete',
        'students',
        NULL,
        ${JSON.stringify({
          task: 'data_retention_purge',
          retentionThresholdDate: retentionThreshold.toISOString(),
          scannedStudents: result.scannedStudents,
          processedStudents: result.processedStudents,
          deletedCounselingNotes: result.deletedCounselingNotes,
          deletedConversationMessages: result.deletedConversationMessages,
          deletedAssignmentSubmissions: result.deletedAssignmentSubmissions,
          nulledPortfolioProposals: result.nulledPortfolioProposals,
        })}::jsonb,
        NOW()
      )
    `);
  } catch (err) {
    logger.warn({ err }, '[data-retention] 감사 로그 기록 실패 (무시됨)');
  }
}
