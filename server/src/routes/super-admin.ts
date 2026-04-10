/**
 * super-admin.ts — Super Admin 전용 라우트
 *
 * Phase 5-2 Multi-Tenancy: 여러 교육기관을 통합 관리하는 슈퍼관리자 API
 *
 * 엔드포인트:
 *   GET    /super-admin/institutions          — 전체 교육기관 목록
 *   POST   /super-admin/institutions          — 신규 교육기관 생성
 *   GET    /super-admin/institutions/:id      — 특정 기관 상세
 *   PUT    /super-admin/institutions/:id      — 기관 정보 수정
 *   PATCH  /super-admin/institutions/:id/deactivate — 기관 비활성화
 *   GET    /super-admin/stats                 — 플랫폼 전체 통계
 *   GET    /super-admin/institutions/:id/stats — 특정 기관 통계
 *
 * 보안: authenticate + requireRole('super_admin') 로 이중 보호
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  institutions,
  students,
  agents,
  costEvents,
  ewsRiskScores,
  ragDocuments,
  eq,
  and,
  sql,
  desc,
} from '@openmento/db';

const router: ReturnType<typeof Router> = Router();

// 모든 /super-admin/* 에 인증 + super_admin 역할 전용 검증
router.use(authenticate);
router.use(requireRole('super_admin'));

// ─── 스키마 ────────────────────────────────────────────────────────────────────

const createInstitutionSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'slug는 소문자·숫자·하이픈만 허용'),
  contactEmail: z.string().email().optional(),
});

const updateInstitutionSchema = createInstitutionSchema.partial();

// ─── 전체 교육기관 목록 ────────────────────────────────────────────────────────

/**
 * GET /super-admin/institutions
 * 플랫폼에 등록된 전체 교육기관 목록 반환 (active/inactive 포함)
 */
router.get('/institutions', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: institutions.id,
        name: institutions.name,
        slug: institutions.slug,
        contactEmail: institutions.contactEmail,
        isActive: institutions.isActive,
        createdAt: institutions.createdAt,
        updatedAt: institutions.updatedAt,
      })
      .from(institutions)
      .orderBy(desc(institutions.createdAt));

    res.json({ institutions: rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '교육기관 목록 조회 실패', details: message });
  }
});

// ─── 신규 교육기관 생성 ────────────────────────────────────────────────────────

/**
 * POST /super-admin/institutions
 * 신규 교육기관을 플랫폼에 등록합니다.
 */
router.post('/institutions', async (req, res) => {
  const parsed = createInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식 오류', details: parsed.error.flatten() });
    return;
  }

  const { name, slug, contactEmail } = parsed.data;

  try {
    // slug 중복 확인
    const existing = await db
      .select({ id: institutions.id })
      .from(institutions)
      .where(eq(institutions.slug, slug));

    if (existing.length > 0) {
      res.status(409).json({ error: `slug '${slug}'는 이미 사용 중입니다.` });
      return;
    }

    const [created] = await db
      .insert(institutions)
      .values({ name, slug, contactEmail, isActive: true })
      .returning();

    res.status(201).json({ institution: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '교육기관 생성 실패', details: message });
  }
});

// ─── 특정 기관 상세 조회 ───────────────────────────────────────────────────────

/**
 * GET /super-admin/institutions/:id
 */
router.get('/institutions/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [institution] = await db
      .select()
      .from(institutions)
      .where(eq(institutions.id, id));

    if (!institution) {
      res.status(404).json({ error: '교육기관을 찾을 수 없습니다.' });
      return;
    }

    res.json({ institution });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '교육기관 조회 실패', details: message });
  }
});

// ─── 기관 정보 수정 ────────────────────────────────────────────────────────────

/**
 * PUT /super-admin/institutions/:id
 */
router.put('/institutions/:id', async (req, res) => {
  const { id } = req.params;
  const parsed = updateInstitutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식 오류', details: parsed.error.flatten() });
    return;
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: '변경할 항목이 없습니다.' });
    return;
  }

  try {
    // slug 변경 시 중복 확인
    if (updates.slug) {
      const existing = await db
        .select({ id: institutions.id })
        .from(institutions)
        .where(and(eq(institutions.slug, updates.slug)));

      if (existing.length > 0 && existing[0]!.id !== id) {
        res.status(409).json({ error: `slug '${updates.slug}'는 이미 사용 중입니다.` });
        return;
      }
    }

    const [updated] = await db
      .update(institutions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(institutions.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: '교육기관을 찾을 수 없습니다.' });
      return;
    }

    res.json({ institution: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '교육기관 수정 실패', details: message });
  }
});

// ─── 기관 비활성화 ─────────────────────────────────────────────────────────────

/**
 * PATCH /super-admin/institutions/:id/deactivate
 * 교육기관을 비활성화합니다. 데이터는 보존됩니다 (하드 삭제 아님).
 */
router.patch('/institutions/:id/deactivate', async (req, res) => {
  const { id } = req.params;

  try {
    const [updated] = await db
      .update(institutions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(institutions.id, id))
      .returning({ id: institutions.id, name: institutions.name, isActive: institutions.isActive });

    if (!updated) {
      res.status(404).json({ error: '교육기관을 찾을 수 없습니다.' });
      return;
    }

    res.json({ message: `${updated.name} 기관이 비활성화되었습니다.`, institution: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '기관 비활성화 실패', details: message });
  }
});

// ─── 플랫폼 전체 통계 ─────────────────────────────────────────────────────────

/**
 * GET /super-admin/stats
 * 전체 플랫폼 현황 집계 (기관수, 수강생수, 이번달 AI 비용 등)
 */
router.get('/stats', async (_req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      institutionCountResult,
      studentCountResult,
      agentCountResult,
      monthlyTokenResult,
      highRiskResult,
      ragDocCountResult,
    ] = await Promise.all([
      // 전체 기관 수 (활성)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(institutions)
        .where(eq(institutions.isActive, true)),

      // 전체 수강생 수 (활성)
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(students)
        .where(eq(students.isActive, true)),

      // 전체 에이전트 수
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(agents),

      // 이번 달 전체 토큰 비용 합계
      db
        .select({ totalCost: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
        .from(costEvents)
        .where(sql`created_at >= ${monthStart.toISOString()}`),

      // 전체 고위험 수강생 수 (totalScore >= 75, 최근 24시간)
      db
        .select({ count: sql<number>`COUNT(DISTINCT student_id)::int` })
        .from(ewsRiskScores)
        .where(
          and(
            sql`total_score >= 75`,
            sql`created_at >= NOW() - INTERVAL '24 hours'`,
          ),
        ),

      // 전체 RAG 문서 수
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(ragDocuments),
    ]);

    res.json({
      activeInstitutions: institutionCountResult[0]?.count ?? 0,
      totalStudents: studentCountResult[0]?.count ?? 0,
      totalAgents: agentCountResult[0]?.count ?? 0,
      monthlyAiCostUsd: monthlyTokenResult[0]?.totalCost ?? 0,
      highRiskStudents24h: highRiskResult[0]?.count ?? 0,
      totalRagDocuments: ragDocCountResult[0]?.count ?? 0,
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '통계 조회 실패', details: message });
  }
});

// ─── 특정 기관 통계 ────────────────────────────────────────────────────────────

/**
 * GET /super-admin/institutions/:id/stats
 * 특정 기관의 세부 현황 (수강생 수, AI 비용, 위험 수강생 등)
 */
router.get('/institutions/:id/stats', async (req, res) => {
  const { id } = req.params;

  try {
    // 기관 존재 확인
    const [institution] = await db
      .select({ id: institutions.id, name: institutions.name })
      .from(institutions)
      .where(eq(institutions.id, id));

    if (!institution) {
      res.status(404).json({ error: '교육기관을 찾을 수 없습니다.' });
      return;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      studentCountResult,
      agentCountResult,
      monthlyTokenResult,
      highRiskResult,
      ragDocCountResult,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(students)
        .where(and(eq(students.institutionId, id), eq(students.isActive, true))),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(agents)
        .where(eq(agents.institutionId, id)),

      db
        .select({ totalCost: sql<number>`COALESCE(SUM(cost_usd), 0)::float` })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.institutionId, id),
            sql`created_at >= ${monthStart.toISOString()}`,
          ),
        ),

      // 특정 기관 고위험 수강생 수 (students JOIN 경유)
      db
        .select({ count: sql<number>`COUNT(DISTINCT ${ewsRiskScores.studentId})::int` })
        .from(ewsRiskScores)
        .innerJoin(students, eq(ewsRiskScores.studentId, students.id))
        .where(
          and(
            eq(students.institutionId, id),
            sql`${ewsRiskScores.totalScore} >= 75`,
            sql`${ewsRiskScores.createdAt} >= NOW() - INTERVAL '24 hours'`,
          ),
        ),

      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(ragDocuments)
        .where(eq(ragDocuments.institutionId, id)),
    ]);

    res.json({
      institutionId: id,
      institutionName: institution.name,
      activeStudents: studentCountResult[0]?.count ?? 0,
      totalAgents: agentCountResult[0]?.count ?? 0,
      monthlyAiCostUsd: monthlyTokenResult[0]?.totalCost ?? 0,
      highRiskStudents24h: highRiskResult[0]?.count ?? 0,
      ragDocuments: ragDocCountResult[0]?.count ?? 0,
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    res.status(500).json({ error: '기관 통계 조회 실패', details: message });
  }
});

export default router;
