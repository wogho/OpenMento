import { Router } from 'express';
import { z } from 'zod';
import { signToken } from '../middleware/auth.js';
import type { UserRole } from '../types/auth.js';

const router: ReturnType<typeof Router> = Router();

// 로그인 요청 스키마 (Zod 검증)
const loginSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['student', 'instructor', 'admin']),
  institutionId: z.string().uuid(),
  // Phase 1에서 실제 자격증명(비밀번호 해시 검증) 구현
  // 현재는 라우트 구조 및 JWT 발급 검증 목적의 스텁
});

// POST /auth/login — JWT 발급
// Phase 1에서 DB 조회 및 비밀번호 검증 로직으로 교체 예정
router.post('/login', (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: result.error.flatten(),
    });
    return;
  }

  const { userId, role, institutionId } = result.data;

  const token = signToken({
    sub: userId,
    role: role as UserRole,
    institutionId,
  });

  res.json({ token });
});

// POST /auth/refresh — 토큰 갱신 (Phase 1에서 구현)
router.post('/refresh', (_req, res) => {
  res.status(501).json({ message: 'Phase 1에서 구현 예정' });
});

export default router;
