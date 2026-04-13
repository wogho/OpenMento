/**
 * Phase 5-3 — 온보딩 투어 완료 상태 API
 *
 * GET   /onboarding/status   — 완료된 투어 목록 + 진행 척도 반환
 * PATCH /onboarding/progress — 스텝별 진행 상태 서버 동기화 (Gemini 제언 ①)
 * POST  /onboarding/complete — 특정 투어 완료 기록 + 소켓 브로드캐스트 (Gemini 제언 ②)
 *
 * 인증: JWT authenticate 필수 (모든 역할 허용)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  onboardingCompletions,
  eq,
  sql,
} from '@openmento/db';
import { io } from '../socket/chat.handler.js';

const router: ReturnType<typeof Router> = Router();

// 모든 온보딩 라우트는 인증 필수 + 최소 역할 검사 (RBAC — Phase 5-5)
router.use(authenticate);
router.use(requireRole('student', 'teacher', 'admin'));

// 허용된 투어 ID 목록 (화이트리스트) — Gemini 제언 ③ 도메인별 투어 포함
const VALID_TOUR_IDS = [
  'admin-tour',
  'student-tour',
  'portfolio-tour',
  'ews-tour',
] as const;
type TourId = (typeof VALID_TOUR_IDS)[number];

// 투어별 최소 허용 역할 (역할 기반 투어 분리 — Phase 5-5)
const TOUR_ALLOWED_ROLES: Record<TourId, string[]> = {
  'admin-tour':     ['admin'],
  'ews-tour':       ['teacher', 'admin'],
  'portfolio-tour': ['student', 'teacher', 'admin'],
  'student-tour':   ['student', 'teacher', 'admin'],
};

const tourIdSchema = z.object({
  tourId: z.enum(VALID_TOUR_IDS),
});

const progressSchema = z.object({
  tourId: z.enum(VALID_TOUR_IDS),
  /** 마지막으로 완료된 스텝 인덱스 (0-based) */
  lastStepIndex: z.number().int().min(0),
});

// ── GET /onboarding/status ────────────────────────────────────────────────────
// 완료된 투어 ID 목록과 진행 중인 투어의 lastStepIndex 맵을 반환합니다.
router.get('/status', async (req, res) => {
  const { sub: userId } = req.user!;

  try {
    const rows = await db
      .select({
        tourId: onboardingCompletions.tourId,
        completedAt: onboardingCompletions.completedAt,
        lastStepIndex: onboardingCompletions.lastStepIndex,
      })
      .from(onboardingCompletions)
      .where(eq(onboardingCompletions.userId, userId));

    const completedTours: TourId[] = rows
      .filter((r) => r.completedAt !== null)
      .map((r) => r.tourId as TourId);

    // 진행 중인 투어의 lastStepIndex 맵 (재접속 시 이어하기용)
    const progressMap: Record<string, number> = {};
    for (const row of rows) {
      if (row.lastStepIndex >= 0) {
        progressMap[row.tourId] = row.lastStepIndex;
      }
    }

    res.json({ completedTours, progressMap });
  } catch {
    res.json({ completedTours: [], progressMap: {} });
  }
});

// ── PATCH /onboarding/progress ────────────────────────────────────────────────
// 각 스텝 전환 시 진행 상태를 서버에 저장합니다.
// 이미 완료된 투어는 진행 상태를 덮어쓰지 않습니다(idempotent).
// Gemini 제언 ①: 브라우저 닫혔다가 재접속해도 마지막 스텝부터 재개 가능.
router.patch('/progress', async (req, res) => {
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 요청입니다.', issues: parsed.error.issues });
    return;
  }

  const { sub: userId, institutionId, role } = req.user!;
  const { tourId, lastStepIndex } = parsed.data;

  // 투어별 역할 접근 제어 (Phase 5-5)
  const allowedRoles = TOUR_ALLOWED_ROLES[tourId];
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: `'${tourId}'는 현재 역할(${role})에서 접근할 수 없습니다.` });
    return;
  }

  try {
    await db
      .insert(onboardingCompletions)
      .values({ userId, institutionId, tourId, lastStepIndex, completedAt: undefined })
      .onConflictDoUpdate({
        target: [onboardingCompletions.userId, onboardingCompletions.tourId],
        // 이미 completed_at 이 있으면 덮어쓰지 않음 (완료 후 재진행 방지)
        set: {
          lastStepIndex: sql`CASE WHEN ${onboardingCompletions.completedAt} IS NULL THEN EXCLUDED.last_step_index ELSE ${onboardingCompletions.lastStepIndex} END`,
        },
      });

    res.json({ ok: true, tourId, lastStepIndex });
  } catch (err) {
    console.error('[onboarding] progress patch error:', err);
    res.json({ ok: true, tourId, lastStepIndex });
  }
});

// ── POST /onboarding/complete ─────────────────────────────────────────────────
// 특정 투어를 완료 상태로 기록하고 socket.io 로 브로드캐스트합니다.
// Gemini 제언 ②: 다른 기기/탭에서 완료 이벤트를 수신해 투어를 즉시 종료합니다.
router.post('/complete', async (req, res) => {
  const parsed = tourIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 tourId입니다.', issues: parsed.error.issues });
    return;
  }

  const { sub: userId, institutionId, role } = req.user!;
  const { tourId } = parsed.data;

  // 투어별 역할 접근 제어 (Phase 5-5)
  const allowedRoles = TOUR_ALLOWED_ROLES[tourId];
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: `'${tourId}'는 현재 역할(${role})에서 접근할 수 없습니다.` });
    return;
  }

  try {
    await db
      .insert(onboardingCompletions)
      .values({ userId, institutionId, tourId, completedAt: new Date() })
      .onConflictDoUpdate({
        target: [onboardingCompletions.userId, onboardingCompletions.tourId],
        set: { completedAt: new Date() },
      });

    // 동일 사용자의 다른 탭/기기에 완료 이벤트 푸시 (Gemini 제언 ②)
    io?.to(`user:${userId}`).emit('onboarding:completed', { tourId });

    res.status(201).json({ ok: true, tourId });
  } catch (err) {
    // 실패해도 투어 완료 UX를 막지 않음
    console.error('[onboarding] complete error:', err);
    res.status(201).json({ ok: true, tourId });
  }
});

// ── DELETE /onboarding/reset (개발/QA 용) ────────────────────────────────────
// 현재 사용자의 온보딩 완료 기록을 초기화합니다.
// production 환경에서는 비활성화.
router.delete('/reset', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'production에서는 허용되지 않습니다.' });
    return;
  }

  const { sub: userId } = req.user!;

  await db
    .delete(onboardingCompletions)
    .where(eq(onboardingCompletions.userId, userId));

  res.json({ ok: true });
});

export default router;
