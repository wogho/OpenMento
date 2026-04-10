import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  students,
  ewsRiskScores,
  eq,
  and,
  isNull,
  sql,
  desc,
  gte,
} from '@openmento/db';

const router: ReturnType<typeof Router> = Router();

// 모든 /instructor/* 라우트에 인증 + 역할 검증 적용
// instructor / admin만 접근 가능
router.use(authenticate);
router.use(requireRole('instructor', 'admin'));

// GET /instructor/me — 강사 본인 정보 조회
router.get('/me', (req, res) => {
  const { sub, institutionId } = req.user!;
  res.json({ userId: sub, institutionId });
});

// GET /instructor/students — 담당 수강생 현황 (최근 EWS 점수 포함, 페이지네이션 지원)
// 쿼리: ?limit=20&offset=0
router.get('/students', async (req, res) => {
  const { institutionId } = req.user!;

  const limitRaw = parseInt(req.query['limit'] as string ?? '20', 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 20 : Math.min(limitRaw, 100);
  const offsetRaw = parseInt(req.query['offset'] as string ?? '0', 10);
  const offset = isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;

  // 수강생 목록 + 가장 최근 EWS 점수 서브쿼리
  const latestScoreSubq = db
    .select({
      studentId: ewsRiskScores.studentId,
      totalScore: sql<number>`max(${ewsRiskScores.totalScore})`.as('latest_score'),
      calculatedAt: sql<Date>`max(${ewsRiskScores.calculatedAt})`.as('latest_calculated_at'),
    })
    .from(ewsRiskScores)
    .groupBy(ewsRiskScores.studentId)
    .as('latest_scores');

  const rows = await db
    .select({
      id: students.id,
      anonymousId: students.anonymousId,
      displayName: students.displayName,
      githubRepo: students.githubRepo,
      courseId: students.courseId,
      enrolledAt: students.enrolledAt,
      latestScore: latestScoreSubq.totalScore,
      scoreCalculatedAt: latestScoreSubq.calculatedAt,
    })
    .from(students)
    .leftJoin(latestScoreSubq, eq(latestScoreSubq.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
      ),
    )
    .orderBy(desc(latestScoreSubq.totalScore))
    .limit(limit)
    .offset(offset);

  // 전체 수강생 수 (페이지네이션 메타 반환용)
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(students)
    .where(and(eq(students.institutionId, institutionId), isNull(students.deletedAt)));

  res.json({
    total: countRow?.total ?? 0,
    limit,
    offset,
    items: rows.map((r) => ({
      id: r.id,
      anonymousId: r.anonymousId,
      displayName: r.displayName,
      githubRepo: r.githubRepo,
      courseId: r.courseId,
      enrolledAt: r.enrolledAt,
      latestEwsScore: r.latestScore ?? null,
      scoreCalculatedAt: r.scoreCalculatedAt ?? null,
      riskLevel:
        r.latestScore == null ? 'unknown'
        : r.latestScore >= 80 ? 'critical'
        : r.latestScore >= 60 ? 'risk'
        : 'normal',
    })),
  });
});

// GET /instructor/ews — 위험 수강생 목록 (최근 30일 score >= 60, 허위 양성 제외)
router.get('/ews', async (req, res) => {
  const { institutionId } = req.user!;
  const cutoff = new Date(Date.now() - 30 * 86400_000);

  const rows = await db
    .select({
      scoreId: ewsRiskScores.id,
      studentId: ewsRiskScores.studentId,
      totalScore: ewsRiskScores.totalScore,
      componentScores: ewsRiskScores.componentScores,
      courseId: students.courseId,
      isFalsePositive: ewsRiskScores.isFalsePositive,
      instructorNote: ewsRiskScores.instructorNote,
      calculatedAt: ewsRiskScores.calculatedAt,
      displayName: students.displayName,
      anonymousId: students.anonymousId,
      githubRepo: students.githubRepo,
    })
    .from(ewsRiskScores)
    .innerJoin(students, eq(ewsRiskScores.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        gte(ewsRiskScores.totalScore, 60),
        gte(ewsRiskScores.calculatedAt, cutoff),
        isNull(ewsRiskScores.isFalsePositive),
        isNull(students.deletedAt),
      ),
    )
    .orderBy(desc(ewsRiskScores.totalScore));

  res.json(
    rows.map((r) => ({
      scoreId: r.scoreId,
      studentId: r.studentId,
      displayName: r.displayName,
      anonymousId: r.anonymousId,
      githubRepo: r.githubRepo,
      courseId: r.courseId,
      totalScore: r.totalScore,
      componentScores: r.componentScores,
      calculatedAt: r.calculatedAt,
      riskLevel: r.totalScore >= 80 ? 'critical' : 'risk',
    })),
  );
});

// GET /instructor/skills — 담당 스킬 파일 조회 (Phase 3)
router.get('/skills', (_req, res) => {
  res.status(501).json({ message: 'Phase 3에서 구현 예정' });
});

export default router;
