/**
 * security.ts — 보안 감사 리포트 API 라우터 (Phase 5-5)
 *
 * ── 엔드포인트 ────────────────────────────────────────────────────────────────
 *
 *   GET /admin/security/audit-report   — 감사 로그 집계 + PII 노출 리포트
 *   GET /admin/security/rbac-report    — 전체 엔드포인트 역할 매핑 리포트
 *
 * ── 접근 제어 ─────────────────────────────────────────────────────────────────
 *
 *   - 모든 엔드포인트: 인증(JWT) + admin 역할 전용
 *   - admin.ts의 `router.use(authenticate); router.use(requireRole('admin'))`에
 *     마운트되므로 여기서는 별도 인증 불필요
 *
 * ── 마운트 위치 ───────────────────────────────────────────────────────────────
 *
 *   admin.ts: adminRouter.use('/security', securityRouter)
 */

import { Router } from 'express';
import {
  db,
  auditLogs,
  students,
  eq,
  sql,
  desc,
} from '@educlip/db';
import { auditPiiExposure } from '../services/anonymization-service.js';

const router: ReturnType<typeof Router> = Router();

// ── GET /admin/security/audit-report ─────────────────────────────────────────
// 기관별 감사 로그 집계 + PII 노출 위험 지표를 종합한 보안 컴플라이언스 리포트

router.get('/audit-report', async (req, res) => {
  const { institutionId } = req.user!;

  // 리포트 기간 (기본 최근 30일)
  const daysBack = Math.min(
    parseInt((req.query.days as string) ?? '30', 10),
    365,
  );
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  try {
    // ① 액션별 감사 로그 건수 집계
    const actionSummary = await db
      .select({
        action: auditLogs.action,
        count: sql<string>`count(*)::int`,
      })
      .from(auditLogs)
      .where(
        eq(auditLogs.institutionId, institutionId),
      )
      .groupBy(auditLogs.action)
      .orderBy(desc(sql`count(*)`));

    // ② 행위자별 최다 호출 액터 (Top 5)
    const topActors = await db
      .select({
        actorId: auditLogs.actorId,
        actorType: auditLogs.actorType,
        count: sql<string>`count(*)::int`,
      })
      .from(auditLogs)
      .where(
        eq(auditLogs.institutionId, institutionId),
      )
      .groupBy(auditLogs.actorId, auditLogs.actorType)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    // ③ 최근 N일 일별 감사 로그 건수 추세
    const dailyTrend = await db
      .select({
        date: sql<string>`DATE(${auditLogs.createdAt})::text`,
        count: sql<string>`count(*)::int`,
      })
      .from(auditLogs)
      .where(
        sql`${auditLogs.institutionId} = ${institutionId}
          AND ${auditLogs.createdAt} >= ${since}`,
      )
      .groupBy(sql`DATE(${auditLogs.createdAt})`)
      .orderBy(sql`DATE(${auditLogs.createdAt})`);

    // ④ PII 노출 위험 감사 (익명화 서비스 연동)
    const piiAudit = await auditPiiExposure(institutionId);

    // ⑤ 수강생 수
    const [studentCount] = await db
      .select({ count: sql<string>`count(*)::int` })
      .from(students)
      .where(
        sql`${students.institutionId} = ${institutionId}
          AND ${students.deletedAt} IS NULL`,
      );

    res.json({
      reportGeneratedAt: new Date().toISOString(),
      institutionId,
      period: { daysBack, since: since.toISOString() },
      summary: {
        totalStudents: Number(studentCount?.count ?? 0),
        totalAuditLogs: actionSummary.reduce((sum, r) => sum + Number(r.count), 0),
        actionBreakdown: actionSummary.map((r) => ({
          action: r.action,
          count: Number(r.count),
        })),
      },
      topActors: topActors.map((r) => ({
        actorId: r.actorId,
        actorType: r.actorType,
        count: Number(r.count),
      })),
      dailyTrend: dailyTrend.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      piiAudit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: '보안 감사 리포트 생성 중 오류가 발생했습니다.', detail: message });
  }
});

// ── GET /admin/security/rbac-report ──────────────────────────────────────────
// 전체 엔드포인트 역할 매핑 리포트 (RBAC 컴플라이언스 검증용)

interface EndpointRbacEntry {
  path: string;
  methods: string[];
  requiredRoles: string[];
  rateLimiter: string;
  notes?: string;
}

const RBAC_MAP: EndpointRbacEntry[] = [
  {
    path: '/auth/login',
    methods: ['POST'],
    requiredRoles: [],
    rateLimiter: 'authLimiter (5req/15min)',
    notes: '공개 엔드포인트 — 인증 불필요',
  },
  {
    path: '/auth/register',
    methods: ['POST'],
    requiredRoles: [],
    rateLimiter: 'authLimiter (5req/15min)',
    notes: '공개 엔드포인트 — 인증 불필요',
  },
  {
    path: '/student/*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    requiredRoles: ['student', 'instructor', 'admin'],
    rateLimiter: 'chatLimiter',
  },
  {
    path: '/instructor/*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    requiredRoles: ['instructor', 'admin'],
    rateLimiter: 'adminLimiter',
  },
  {
    path: '/admin/*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    requiredRoles: ['admin'],
    rateLimiter: 'adminLimiter',
  },
  {
    path: '/admin/security/*',
    methods: ['GET'],
    requiredRoles: ['admin'],
    rateLimiter: 'adminLimiter',
    notes: 'Phase 5-5: 보안 감사 리포트 — admin 전용',
  },
  {
    path: '/portfolio/*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    requiredRoles: ['student', 'instructor', 'admin'],
    rateLimiter: 'chatLimiter',
  },
  {
    path: '/onboarding/status',
    methods: ['GET'],
    requiredRoles: ['student', 'instructor', 'admin', 'super_admin'],
    rateLimiter: 'chatLimiter',
  },
  {
    path: '/onboarding/progress',
    methods: ['PATCH'],
    requiredRoles: ['student', 'instructor', 'admin', 'super_admin'],
    rateLimiter: 'chatLimiter',
    notes: 'Phase 5-5: 투어별 역할 추가 제한 (admin-tour: admin/super_admin만)',
  },
  {
    path: '/onboarding/complete',
    methods: ['POST'],
    requiredRoles: ['student', 'instructor', 'admin', 'super_admin'],
    rateLimiter: 'chatLimiter',
    notes: 'Phase 5-5: 투어별 역할 추가 제한 (ews-tour: instructor 이상)',
  },
  {
    path: '/super-admin/*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    requiredRoles: ['super_admin'],
    rateLimiter: 'adminLimiter',
  },
  {
    path: '/webhook/github',
    methods: ['POST'],
    requiredRoles: [],
    rateLimiter: 'webhookLimiter',
    notes: '공개 엔드포인트 — HMAC-SHA256 서명 검증으로 보호 (JWT 불필요)',
  },
  {
    path: '/health',
    methods: ['GET'],
    requiredRoles: [],
    rateLimiter: '없음',
    notes: '공개 상태 확인 — 민감 정보 미포함',
  },
];

router.get('/rbac-report', (_req, res) => {
  res.json({
    reportGeneratedAt: new Date().toISOString(),
    totalEndpoints: RBAC_MAP.length,
    publicEndpoints: RBAC_MAP.filter((e) => e.requiredRoles.length === 0).length,
    protectedEndpoints: RBAC_MAP.filter((e) => e.requiredRoles.length > 0).length,
    endpoints: RBAC_MAP,
  });
});

export default router;
