import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { tutorChat, getChatHistory } from '../services/tutor-agent.js';

const router: ReturnType<typeof Router> = Router();

// 모든 /student/* 라우트에 인증 + 역할 검증 적용
// student / instructor / admin 모두 접근 가능 (강사가 수강생 포털 조회 가능)
router.use(authenticate);
router.use(requireRole('student', 'instructor', 'admin'));

// GET /student/me — 수강생 본인 정보 조회
router.get('/me', (req, res) => {
  const { sub, institutionId } = req.user!;
  res.json({ userId: sub, institutionId });
});

// GET /student/courses — 수강 중인 과정 목록 (Phase 1 후반)
router.get('/courses', (_req, res) => {
  res.status(501).json({ message: 'Phase 1 후반에서 구현 예정' });
});

// ── AI 튜터 채팅 API (Phase 1-2) ───────────────────────────────────────

const chatRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  agentId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
});

/**
 * POST /student/chat
 * 수강생 질문 → RAG 컨텍스트 검색 → 소크라테스식 LLM 응답
 *
 * Body: { question, agentId, sessionId?, courseId? }
 * Response: { sessionId, answer, ragSourceCount, model, inputTokens, outputTokens }
 */
router.post('/chat', async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;
  const { question, agentId, sessionId, courseId } = parsed.data;

  const result = await tutorChat({
    sessionId,
    studentId,
    institutionId,
    courseId,
    question,
    agentId,
  });

  res.json(result);
});

// 세션 이력 검증 스키마
const historyParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

/**
 * GET /student/chat/:sessionId
 * 특정 세션의 대화 이력 조회 (수강생 본인 세션만 허용)
 */
router.get('/chat/:sessionId', async (req, res) => {
  const parsed = historyParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 sessionId 형식입니다.' });
    return;
  }

  const { sub: studentId } = req.user!;
  const { sessionId } = parsed.data;

  const history = await getChatHistory(sessionId, studentId);
  res.json({ sessionId, messages: history });
});

export default router;
