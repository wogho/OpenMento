import { Router } from 'express';
import { z } from 'zod';
import { signToken } from '../middleware/auth.js';
import type { UserRole } from '../types/auth.js';

const router: ReturnType<typeof Router> = Router();

// 로그인 요청 스키마 (Zod 검증)
// Phase 5-2: super_admin role 추가 — institutionId는 super_admin이면 'super' 고정
const loginSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['student', 'instructor', 'admin', 'super_admin']),
  institutionId: z.string(), // super_admin은 'super' 고정값, 나머지는 UUID
  // Phase 1에서 실제 자격증명(비밀번호 해시 검증) 구현
  // 현재는 라우트 구조 및 JWT 발급 검증 목적의 스텁
}).refine(
  (data) => data.role === 'super_admin' ? data.institutionId === 'super' : /^[0-9a-f-]{36}$/.test(data.institutionId),
  { message: 'super_admin은 institutionId=\'super\'를 사용하고, 나머지 역할은 UUID여야 합니다.', path: ['institutionId'] },
);

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
