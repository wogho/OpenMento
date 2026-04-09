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
  getActiveWorkflow,
  saveDraft,
} from '../services/portfolio-orchestrator.js';
import { getIndustryList } from '../services/persona-prompts.js';
import {
  listPersonas,
  createPersona,
  updatePersona,
  deletePersona,
} from '../services/persona-service.js';
import { analyzePortfolioSimilarity } from '../services/portfolio-similarity.js';
import { getPortfolioSettings } from '../services/portfolio-settings-store.js';

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

// ── GET /portfolio/active — 수강생의 진행 중인 세션 복구 (개선①) ─────────────

router.get('/active', async (req, res) => {
  const { sub: studentId } = req.user!;
  try {
    const state = await getActiveWorkflow(studentId);
    if (!state) {
      res.status(404).json({ error: '진행 중인 포트폴리오 세션이 없습니다.' });
      return;
    }
    res.json(state);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? '세션 조회 중 오류가 발생했습니다.',
    });
  }
});

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

// ── POST /portfolio/:goalId/message/stream — SSE 스트리밍 응답 (개선③) ────────
// 전체 응답을 한번에 주는 대신 단어 단위로 SSE 청크를 송출해 타이핑 UX 구현.
router.post('/:goalId/message/stream', async (req, res) => {
  const { goalId } = req.params;

  const goalIdParsed = goalIdSchema.safeParse(goalId);
  if (!goalIdParsed.success) {
    res.status(400).json({ error: goalIdParsed.error.flatten() });
    return;
  }

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    return;
  }

  const { sub: studentId } = req.user!;

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Nginx 버퍼링 비활성화
  res.flushHeaders();

  const sendEvent = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    // 1. 전체 응답 처리 (기존 advanceWorkflow 재사용)
    const state = await advanceWorkflow({
      goalId,
      studentId,
      userMessage: parsed.data.content,
    });

    // 2. 마지막 에이전트 응답 메시지 추출
    const lastMsg = state.messages.at(-1);
    const fullText = lastMsg?.content ?? '';

    // 3. 단어 단위 스트리밍 (자연스러운 타이핑 속도: 단어 당 30~70ms)
    const words = fullText.split(/(?<=\s)/); // 공백 뒤에서 분리 (공백 포함)
    for (const word of words) {
      sendEvent({ type: 'chunk', text: word });
      // 비동기 지연 (Node.js 이벤트 루프 양보)
      await new Promise<void>((resolve) => setTimeout(resolve, 30 + Math.random() * 40));
    }

    // 4. 완료 이벤트: 최종 워크플로우 상태 전송
    sendEvent({ type: 'done', state });
    res.end();
  } catch (err) {
    const error = err as Error;
    sendEvent({ type: 'error', message: error.message ?? '워크플로우 오류가 발생했습니다.' });
    res.end();
  }
});

// ── PUT /portfolio/:goalId/draft — 기획서 임시 저장 (개선②) ─────────────────

const draftSchema = z.object({
  proposalText: z.string().max(50000, '기획서는 50,000자 이하여야 합니다.'),
});

router.put('/:goalId/draft', async (req, res) => {
  const { goalId } = req.params;

  const goalIdParsed = goalIdSchema.safeParse(goalId);
  if (!goalIdParsed.success) {
    res.status(400).json({ error: goalIdParsed.error.flatten() });
    return;
  }

  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    return;
  }

  try {
    await saveDraft(goalId, parsed.data.proposalText);
    res.json({ ok: true });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? '임시 저장 중 오류가 발생했습니다.',
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

// ── 유사도 분석 ────────────────────────────────────────────────────────────

const analyzeSchema = z.object({
  projectId: z.string().uuid({ message: 'projectId는 UUID여야 합니다.' }),
  proposalText: z
    .string()
    .min(50, '기획서 텍스트는 50자 이상이어야 합니다.')
    .max(8000, '기획서 텍스트는 8000자 이하여야 합니다.'),
  feedbackStyle: z.enum(['socratic', 'direct']).default('direct'),
  compareScope: z.enum(['all', 'current_cohort']).default('all'),
  courseId: z.string().uuid().optional(),
  thresholdCritical: z.number().min(0).max(1).optional(),
  thresholdWarning: z.number().min(0).max(1).optional(),
});

// POST /portfolio/analyze — 유사도 분석 실행 (Phase 4-2)
router.post('/analyze', async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: '입력값이 유효하지 않습니다.',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { institutionId } = req.user!;
  const adminSettings = await getPortfolioSettings(institutionId);

  const {
    projectId,
    proposalText,
    feedbackStyle = adminSettings.defaultFeedbackStyle,
    compareScope  = adminSettings.compareScope,
    courseId,
    thresholdCritical = adminSettings.criticalThreshold / 100,
    thresholdWarning  = adminSettings.warningThreshold  / 100,
  } = parsed.data;

  if (compareScope === 'current_cohort' && !courseId) {
    return res.status(400).json({
      error: "compareScope='current_cohort'일 때 courseId가 필요합니다.",
    });
  }

  try {
    const result = await analyzePortfolioSimilarity({
      projectId,
      proposalText,
      feedbackStyle,
      compareScope,
      courseId,
      institutionId,
      thresholdCritical,
      thresholdWarning,
    });

    return res.status(200).json(result);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    return res.status(error.statusCode ?? 500).json({ error: error.message });
  }
});

export default router;

