/**
 * Phase 4-1 — 포트폴리오 오케스트레이션 API 라우터
 *
 * 엔드포인트:
 *   POST /portfolio/start          — 워크플로우 시작 (페르소나 선택 + 인터뷰 첫 메시지)
 *   POST /portfolio/:goalId/message — 워크플로우 진행 (사용자 메시지 → 에이전트 응답)
 *   GET  /portfolio/:goalId         — 현재 상태 전체 조회
 *
 * plan.md 4-1: "다중 에이전트 오케스트레이션 워크플로우"
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  startPortfolioWorkflow,
  advanceWorkflow,
  getWorkflowState,
} from '../services/portfolio-orchestrator.js';
import { getIndustryList } from '../services/persona-prompts.js';

const router: ReturnType<typeof Router> = Router();

// 수강생·강사·관리자 모두 접근 가능 (수강생이 주 사용자)
router.use(authenticate);
router.use(requireRole('student', 'instructor', 'admin'));

// ── 입력 검증 스키마 ──────────────────────────────────────────────────────

const startSchema = z.object({
  courseId: z.string().uuid({ message: 'courseId는 UUID여야 합니다.' }),
  personaId: z.string().optional(),
  agentId: z.string().uuid().optional(),
});

const messageSchema = z.object({
  content: z
    .string()
    .min(1, '메시지는 1자 이상이어야 합니다.')
    .max(5000, '메시지는 5000자 이하여야 합니다.'),
});

// ── GET /portfolio/personas — 선택 가능한 산업 페르소나 목록 ─────────────────

router.get('/personas', (_req, res) => {
  res.json({ personas: getIndustryList() });
});

// ── POST /portfolio/start ──────────────────────────────────────────────────

router.post('/start', async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;
  const { courseId, personaId, agentId } = parsed.data;

  try {
    const state = await startPortfolioWorkflow({
      studentId,
      institutionId,
      courseId,
      personaId,
      agentId,
    });

    res.status(201).json(state);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? '워크플로우를 시작하는 중 오류가 발생했습니다.',
    });
  }
});

// ── POST /portfolio/:goalId/message ──────────────────────────────────────

router.post('/:goalId/message', async (req, res) => {
  const { goalId } = req.params;

  const goalIdParsed = z
    .string()
    .uuid({ message: 'goalId는 UUID여야 합니다.' })
    .safeParse(goalId);
  if (!goalIdParsed.success) {
    res.status(400).json({ error: goalIdParsed.error.flatten() });
    return;
  }

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { sub: studentId } = req.user!;

  try {
    const state = await advanceWorkflow({
      goalId,
      studentId,
      userMessage: parsed.data.content,
    });

    res.json(state);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? '워크플로우를 진행하는 중 오류가 발생했습니다.',
    });
  }
});

// ── GET /portfolio/:goalId ────────────────────────────────────────────────

router.get('/:goalId', async (req, res) => {
  const { goalId } = req.params;

  const goalIdParsed = z
    .string()
    .uuid({ message: 'goalId는 UUID여야 합니다.' })
    .safeParse(goalId);
  if (!goalIdParsed.success) {
    res.status(400).json({ error: goalIdParsed.error.flatten() });
    return;
  }

  try {
    const state = await getWorkflowState(goalId);
    res.json(state);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? '워크플로우 상태를 불러오는 중 오류가 발생했습니다.',
    });
  }
});

export default router;
