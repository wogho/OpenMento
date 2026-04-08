/**
 * Phase 4-1 — 포트폴리오 오케스트레이션 API 라우터
 *
 * 엔드포인트:
 *   POST /portfolio/start                    — 워크플로우 시작 (페르소나 선택 + 인터뷰 첫 메시지)
 *   POST /portfolio/:goalId/message          — 워크플로우 진행 (사용자 메시지 → 에이전트 응답)
 *   GET  /portfolio/:goalId                  — 현재 상태 전체 조회
 *   POST /portfolio/:goalId/hitl-review      — 강사 HITL 승인/거부 (개선③)
 *   GET  /portfolio/personas                 — 페르소나 목록 조회
 *   POST /admin/personas                     — 커스텀 페르소나 생성 (개선①)
 *   PUT  /admin/personas/:id                 — 커스텀 페르소나 수정 (개선①)
 *   DELETE /admin/personas/:id              — 커스텀 페르소나 삭제 (개선①)
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
  processHitlReview,
} from '../services/portfolio-orchestrator.js';
import { getIndustryList } from '../services/persona-prompts.js';
import {
  listPersonas,
  createPersona,
  updatePersona,
  deletePersona,
} from '../services/persona-service.js';

const router: ReturnType<typeof Router> = Router();

// 수강생·강사·관리자 모두 접근 가능 (수강생이 주 사용자)
router.use(authenticate);
router.use(requireRole('student', 'instructor', 'admin'));

// ── 입력 검증 스키마 ──────────────────────────────────────────────────────

const startSchema = z.object({
  courseId: z.string().uuid({ message: 'courseId는 UUID여야 합니다.' }),
  personaId: z.string().optional(),
  agentId: z.string().uuid().optional(),
  hitlEnabled: z.boolean().optional(),
});

const messageSchema = z.object({
  content: z
    .string()
    .min(1, '메시지는 1자 이상이어야 합니다.')
    .max(5000, '메시지는 5000자 이하여야 합니다.'),
});

const hitlReviewSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().max(2000).optional(),
});

const personaCreateSchema = z.object({
  industry: z.string().min(1).max(100),
  role: z.string().min(1).max(100),
  prompt: z.string().min(10).max(10000),
  legacyKey: z.string().max(100).optional(),
});

const personaUpdateSchema = personaCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const goalIdSchema = z.string().uuid({ message: 'goalId는 UUID여야 합니다.' });

// ── GET /portfolio/personas — 선택 가능한 산업 페르소나 목록 ─────────────────
// (DB 기반 + 레거시 폴백)
router.get('/personas', async (req, res) => {
  try {
    const { institutionId } = req.user!;
    const personas = await listPersonas(institutionId);
    // DB가 비어 있으면 레거시 하드코딩 목록 반환
    if (personas.length === 0) {
      res.json({ personas: getIndustryList() });
      return;
    }
    res.json({
      personas: personas.map((p) => ({
        id: p.id,
        industry: p.industry,
        role: p.role,
        legacyKey: p.legacyKey,
      })),
    });
  } catch {
    // 오류 시 레거시 폴백
    res.json({ personas: getIndustryList() });
  }
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
  const { courseId, personaId, agentId, hitlEnabled } = parsed.data;

  try {
    const state = await startPortfolioWorkflow({
      studentId,
      institutionId,
      courseId,
      personaId,
      agentId,
      hitlEnabled,
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

  const goalIdParsed = goalIdSchema.safeParse(goalId);
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

// ── POST /portfolio/:goalId/hitl-review — 강사 HITL 승인/거부 (개선③) ────────

router.post('/:goalId/hitl-review', requireRole('instructor', 'admin'), async (req, res) => {
  const { goalId } = req.params;

  const goalIdParsed = goalIdSchema.safeParse(goalId);
  if (!goalIdParsed.success) {
    res.status(400).json({ error: goalIdParsed.error.flatten() });
    return;
  }

  const parsed = hitlReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { sub: instructorId } = req.user!;

  try {
    const state = await processHitlReview({
      goalId,
      instructorId,
      approved: parsed.data.approved,
      feedback: parsed.data.feedback,
    });

    res.json(state);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? 'HITL 검토 처리 중 오류가 발생했습니다.',
    });
  }
});

// ── GET /portfolio/:goalId ────────────────────────────────────────────────

router.get('/:goalId', async (req, res) => {
  const { goalId } = req.params;

  const goalIdParsed = goalIdSchema.safeParse(goalId);
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

// ── 페르소나 CRUD (개선①) — 강사/관리자 전용 ─────────────────────────────────

// GET /portfolio/personas/list — DB 기반 전체 목록 (legacyKey 포함)
router.get('/personas/list', requireRole('instructor', 'admin'), async (req, res) => {
  try {
    const { institutionId } = req.user!;
    const personas = await listPersonas(institutionId);
    res.json({ personas });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// POST /portfolio/personas — 커스텀 페르소나 생성
router.post('/personas', requireRole('instructor', 'admin'), async (req, res) => {
  const parsed = personaCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { institutionId } = req.user!;

  try {
    const persona = await createPersona(institutionId, parsed.data);
    res.status(201).json({ persona });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// PUT /portfolio/personas/:id — 커스텀 페르소나 수정
router.put('/personas/:id', requireRole('instructor', 'admin'), async (req, res) => {
  const { id } = req.params;
  const parsed = personaUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { institutionId } = req.user!;

  try {
    const persona = await updatePersona(id, institutionId, parsed.data);
    res.json({ persona });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }
});

// DELETE /portfolio/personas/:id — 커스텀 페르소나 Soft Delete
router.delete('/personas/:id', requireRole('instructor', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { institutionId } = req.user!;

  try {
    await deletePersona(id, institutionId);
    res.status(204).send();
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({ error: error.message });
  }
});

export default router;
