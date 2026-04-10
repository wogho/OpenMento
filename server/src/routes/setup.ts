/**
 * setup.ts — 플랫폼 초기 설치 라우터
 *
 * ── 엔드포인트 ────────────────────────────────────────────────────────────────
 *
 *   GET  /setup/status        — 플랫폼 초기화 여부 확인 (인증 불필요)
 *   POST /setup/initialize    — 첫 교육기관 + 관리자 계정 생성 (미초기화 상태에만 허용)
 *
 * ── 보안 ──────────────────────────────────────────────────────────────────────
 *   - initialize는 admin_users 행이 0개일 때만 실행 가능 (TOCTOU 방지용 DB 트랜잭션)
 *   - 비밀번호는 bcryptjs(cost=12)로 해시 저장
 */

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db, institutions, adminUsers, agents, institutionSettings, count } from '@openmento/db';
import { signToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router: ReturnType<typeof Router> = Router();

// ── GET /setup/status — 초기화 여부 반환 ─────────────────────────────────────
router.get('/status', async (_req, res) => {
  try {
    const [row] = await db.select({ cnt: count() }).from(adminUsers);
    res.json({ needsSetup: (row?.cnt ?? 0) === 0 });
  } catch (err) {
    logger.error({ err }, '[setup] status 조회 실패');
    res.status(500).json({ error: '상태 확인 중 오류가 발생했습니다.' });
  }
});

// 초기화 요청 스키마
const initSchema = z.object({
  institutionName: z.string().min(2, '기관명은 2자 이상이어야 합니다.').max(100),
  adminName: z.string().min(2, '이름은 2자 이상이어야 합니다.').max(50),
  adminEmail: z.string().email('올바른 이메일 형식이 아닙니다.'),
  adminPassword: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
  llmProvider: z.enum(['openai', 'anthropic', 'google']).optional().default('openai'),
  llmApiKey: z.string().min(1, 'API 키를 입력해 주세요.').optional(),
});

// ── POST /setup/initialize — 첫 기관 + 관리자 계정 생성 ───────────────────────
router.post('/initialize', async (req, res) => {
  const result = initSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: result.error.flatten() });
    return;
  }

  const { institutionName, adminName, adminEmail, adminPassword, llmProvider, llmApiKey } = result.data;

  try {
    await db.transaction(async (tx) => {
      // 이미 초기화된 경우 차단 (동시 요청 방지)
      const [check] = await tx.select({ cnt: count() }).from(adminUsers);
      if ((check?.cnt ?? 0) > 0) {
        throw Object.assign(new Error('already_initialized'), { status: 409 });
      }

      // 1. 기관 생성
      const slug = institutionName
        .toLowerCase()
        .replace(/[^a-z0-9가-힣]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 50);

      const [institution] = await tx
        .insert(institutions)
        .values({ name: institutionName, slug: `${slug}-${Date.now()}` })
        .returning({ id: institutions.id });

      if (!institution) throw new Error('기관 생성에 실패했습니다.');

      // 2. 관리자 계정 생성 (bcrypt cost=12)
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await tx.insert(adminUsers).values({
        institutionId: institution.id,
        email: adminEmail,
        passwordHash,
        name: adminName,
        role: 'admin',
      });

      // 3. 기본 AI 튜터 에이전트 씨드
      await tx.insert(agents).values({
        institutionId: institution.id,
        name: 'AI 튜터',
        slug: 'ai-tutor',
        role: 'ai_tutor',
        systemPrompt: '당신은 소크라테스식 문답법을 사용하는 AI 교육 튜터입니다. 학생이 스스로 답을 찾을 수 있도록 유도하는 질문을 합니다.',
        adapterConfig: {
          provider: llmProvider ?? 'openai',
          model: llmProvider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : llmProvider === 'google' ? 'gemini-1.5-pro' : 'gpt-4o',
        },
        isActive: true,
      });

      // 4. LLM API 키 저장 (입력된 경우)
      if (llmApiKey) {
        await tx.insert(institutionSettings).values({
          institutionId: institution.id,
          settingKey: 'secrets',
          settingValue: {
            [`${llmProvider ?? 'openai'}ApiKey`]: llmApiKey,
          },
        });
      }

      // 5. JWT 발급 (초기화 완료 후 자동 로그인)
      const token = signToken({
        sub: adminEmail,
        role: 'admin',
        institutionId: institution.id,
        name: adminName,
      });

      res.json({ token, institutionId: institution.id });
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.message === 'already_initialized') {
      res.status(409).json({ error: '플랫폼이 이미 초기화되어 있습니다.' });
      return;
    }
    logger.error({ err }, '[setup] 초기화 실패');
    res.status(500).json({ error: '초기화 중 오류가 발생했습니다.' });
  }
});

export default router;
