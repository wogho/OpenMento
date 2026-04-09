/**
 * Phase 5-3 — 온보딩 투어 완료 상태 API
 *
 * GET  /onboarding/status          — 현재 사용자의 완료된 투어 목록 반환
 * POST /onboarding/complete        — 특정 투어 완료 기록 (중복 시 무시)
 *
 * 인증: JWT authenticate 필수 (모든 역할 허용)
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import {
  db,
  onboardingCompletions,
  eq,
  and,
} from '@educlip/db';

const router: ReturnType<typeof Router> = Router();

// 모든 온보딩 라우트는 인증 필수
router.use(authenticate);

// 허용된 투어 ID 목록 (화이트리스트)
const VALID_TOUR_IDS = ['admin-tour', 'student-tour'] as const;
type TourId = (typeof VALID_TOUR_IDS)[number];

const completeTourSchema = z.object({
  tourId: z.enum(VALID_TOUR_IDS),
});

// ── GET /onboarding/status ────────────────────────────────────────────────────
// 현재 로그인한 사용자가 완료한 투어 ID 목록을 반환합니다.
router.get('/status', async (req, res) => {
  const { sub: userId } = req.user!;

  try {
    const rows = await db
      .select({ tourId: onboardingCompletions.tourId })
      .from(onboardingCompletions)
      .where(eq(onboardingCompletions.userId, userId));

    const completedTours: TourId[] = rows.map((r) => r.tourId as TourId);
    res.json({ completedTours });
  } catch {
    res.json({ completedTours: [] });
  }
});

// ── POST /onboarding/complete ─────────────────────────────────────────────────
// 특정 투어를 완료 상태로 기록합니다. 이미 완료된 경우 幂等(idempotent) 처리.
router.post('/complete', async (req, res) => {
  const parsed = completeTourSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 tourId입니다.', issues: parsed.error.issues });
    return;
  }

  const { sub: userId, institutionId } = req.user!;
  const { tourId } = parsed.data;

  try {
    // unique 제약으로 중복 삽입 시 무시 (온 충돌 무시)
    await db
      .insert(onboardingCompletions)
      .values({ userId, institutionId, tourId })
      .onConflictDoNothing();

    res.status(201).json({ ok: true, tourId });
  } catch (err) {
    // 삽입 실패해도 투어 완료 UX를 막지 않음
    console.error('[onboarding] complete insert error:', err);
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
