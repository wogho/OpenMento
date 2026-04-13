import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db, adminUsers, institutions, students } from '@openmento/db';
import { eq, and, isNull } from '@openmento/db';
import { signToken, authenticate } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import type { UserRole } from '../types/auth.js';
import { loginFailureLimiter } from '../middleware/rateLimiter.js';

const router: ReturnType<typeof Router> = Router();

// 로그인 요청 스키마 — 이메일/비밀번호 방식
const loginSchema = z.object({
  email: z.string().email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

// POST /auth/login — 이메일+비밀번호 검증 후 JWT 발급
router.post('/login', loginFailureLimiter, async (req, res) => {
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
    const [row] = await db
      .select({
        user: adminUsers,
        institutionName: institutions.name,
      })
      .from(adminUsers)
      .leftJoin(institutions, eq(adminUsers.institutionId, institutions.id))
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (!row || !row.user || !row.user.isActive) {
      // 사용자 미존재와 비밀번호 오류를 동일한 메시지로 처리 (열거형 공격 방지)
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }

    const { user, institutionName } = row;

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
      institutionName: institutionName ?? undefined,
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

// POST /auth/student-login — 수강생 전용 로그인 (students 테이블 기반)
router.post('/student-login', loginFailureLimiter, async (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: result.error.flatten() });
    return;
  }
  const { email, password } = result.data;
  try {
    const [row] = await db
      .select({ student: students, institutionName: institutions.name })
      .from(students)
      .leftJoin(institutions, eq(students.institutionId, institutions.id))
      .where(eq(students.email, email))
      .limit(1);

    if (!row || !row.student || !row.student.isActive || !row.student.passwordHash) {
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    const isValid = await bcrypt.compare(password, row.student.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
      return;
    }
    const token = signToken({
      sub: row.student.id,
      role: 'student' as UserRole,
      institutionId: row.student.institutionId,
      institutionName: row.institutionName ?? undefined,
      name: row.student.displayName ?? undefined,
    });
    res.json({ token });
  } catch (err) {
    logger.error({ err }, '[auth] 수강생 로그인 처리 실패');
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});



// POST /auth/switch-institution — Admin용 기관 전환 (Tenant Switch)
router.post('/switch-institution', authenticate, async (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: '권한이 없습니다.' });
    return;
  }

  const { targetInstitutionId } = req.body;
  if (!targetInstitutionId) {
    res.status(400).json({ error: '대상 기관 ID가 필요합니다.' });
    return;
  }

  try {
    const [inst] = await db
      .select({ name: institutions.name })
      .from(institutions)
      .where(eq(institutions.id, targetInstitutionId))
      .limit(1);

    if (!inst) {
      res.status(404).json({ error: '기관을 찾을 수 없습니다.' });
      return;
    }

    const token = signToken({
      sub: req.user.sub,
      role: req.user.role,
      institutionId: targetInstitutionId,
      institutionName: inst.name,
      name: req.user.name,
    });

    res.json({ token, institutionName: inst.name });
  } catch (err) {
    logger.error({ err }, '[auth] 기관 전환 실패');
    res.status(500).json({ error: '기관 전환 중 오류가 발생했습니다.' });
  }
});

// GET /auth/register/info?token=<anonymousId>
// 초대 토큰이 유효한지 확인하고 기관 이름 등 사전 정보를 반환합니다.
router.get('/register/info', async (req, res) => {
  const token = req.query['token'];
  if (typeof token !== 'string' || !token.trim()) {
    res.status(400).json({ error: '유효하지 않은 초대 토큰입니다.' });
    return;
  }
  try {
    const [row] = await db
      .select({
        anonymousId: students.anonymousId,
        displayName: students.displayName,
        institutionId: students.institutionId,
        institutionName: institutions.name,
        email: students.email,
      })
      .from(students)
      .leftJoin(institutions, eq(students.institutionId, institutions.id))
      .where(and(
        eq(students.anonymousId, token),
        isNull(students.deletedAt),
      ))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: '초대 링크를 찾을 수 없습니다. 관리자에게 문의해 주세요.' });
      return;
    }
    if (row.email) {
      res.status(409).json({ error: '이미 가입이 완료된 초대 링크입니다. 로그인 페이지에서 접속하세요.' });
      return;
    }
    res.json({
      institutionName: row.institutionName ?? '알 수 없는 기관',
      institutionId: row.institutionId,
      displayName: row.displayName,
    });
  } catch (err) {
    logger.error({ err }, '[auth] register/info 처리 실패');
    res.status(500).json({ error: '처리 중 오류가 발생했습니다.' });
  }
});

// POST /auth/register — 초대 토큰을 이용한 수강생 최초 회원가입
const registerSchema = z.object({
  token: z.string().uuid('유효하지 않은 초대 토큰 형식입니다.'),
  email: z.string().email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(8, '비밀번호는 최소 8자 이상이어야 합니다.'),
  displayName: z.string().min(1).max(50).optional(),
});

router.post('/register', async (req, res) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: result.error.flatten() });
    return;
  }
  const { token, email, password, displayName } = result.data;

  try {
    // 토큰(anonymousId) 기반으로 미가입 수강생 조회
    const [row] = await db
      .select({
        student: students,
        institutionName: institutions.name,
      })
      .from(students)
      .leftJoin(institutions, eq(students.institutionId, institutions.id))
      .where(and(
        eq(students.anonymousId, token),
        isNull(students.email),       // 미가입 상태만 허용
        isNull(students.deletedAt),
      ))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: '초대 링크가 유효하지 않거나 이미 가입이 완료되었습니다.' });
      return;
    }

    // 동일 이메일 중복 가입 방지
    const [existing] = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.email, email), isNull(students.deletedAt)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [updated] = await db
      .update(students)
      .set({
        email,
        passwordHash,
        displayName: displayName ?? row.student.displayName,
        updatedAt: new Date(),
      })
      .where(eq(students.id, row.student.id))
      .returning({ id: students.id, institutionId: students.institutionId, displayName: students.displayName });

    if (!updated) {
      res.status(500).json({ error: '계정 생성 중 오류가 발생했습니다.' });
      return;
    }

    // 가입 완료 후 바로 로그인 처리 (JWT 발급)
    const jwtToken = signToken({
      sub: updated.id,
      role: 'student' as UserRole,
      institutionId: updated.institutionId,
      institutionName: row.institutionName ?? undefined,
      name: updated.displayName ?? undefined,
    });

    logger.info({ studentId: updated.id }, '[auth] 수강생 회원가입 완료');
    res.status(201).json({ token: jwtToken });
  } catch (err) {
    logger.error({ err }, '[auth] 수강생 회원가입 처리 실패');
    res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

export default router;
