import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db, adminUsers } from '@openmento/db';
import { eq } from '@openmento/db';
import { signToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { UserRole } from '../types/auth.js';

const router: ReturnType<typeof Router> = Router();

// 로그인 요청 스키마 — 이메일/비밀번호 방식
const loginSchema = z.object({
  email: z.string().email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

// POST /auth/login — 이메일+비밀번호 검증 후 JWT 발급
router.post('/login', async (req, res) => {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: result.error.flatten(),
    });
    return;
  }

  const { email, password } = result.data;

  try {
    // DB에서 이메일로 관리자 계정 조회
    const [user] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (!user || !user.isActive) {
      // 사용자 미존재와 비밀번호 오류를 동일한 메시지로 처리 (열거형 공격 방지)
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }

    // 마지막 로그인 시각 업데이트 (비동기, 응답 지연 없음)
    db.update(adminUsers)
      .set({ lastLoginAt: new Date() })
      .where(eq(adminUsers.id, user.id))
      .catch((err: unknown) => logger.warn({ err }, '[auth] lastLoginAt 업데이트 실패'));

    const token = signToken({
      sub: user.id,
      role: user.role as UserRole,
      institutionId: user.institutionId,
      name: user.name,
    });

    res.json({ token });
  } catch (err) {
    logger.error({ err }, '[auth] 로그인 처리 실패');
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

// POST /auth/refresh — 토큰 갱신 (Phase 1에서 구현)
router.post('/refresh', (_req, res) => {
  res.status(501).json({ message: 'Phase 1에서 구현 예정' });
});

export default router;
