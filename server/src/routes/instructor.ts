import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router: ReturnType<typeof Router> = Router();

// 모든 /instructor/* 라우트에 인증 + 역할 검증 적용
// instructor / admin만 접근 가능
router.use(authenticate);
router.use(requireRole('instructor', 'admin'));

// GET /instructor/me — 강사 본인 정보 조회
router.get('/me', (req, res) => {
  const { sub, institutionId } = req.user!;
  res.json({ userId: sub, institutionId });
});

// GET /instructor/students — 담당 수강생 현황 (Phase 2)
router.get('/students', (_req, res) => {
  res.status(501).json({ message: 'Phase 2에서 구현 예정' });
});

// GET /instructor/ews — EWS 위험 수강생 목록 (Phase 2)
router.get('/ews', (_req, res) => {
  res.status(501).json({ message: 'Phase 2에서 구현 예정' });
});

// GET /instructor/skills — 담당 스킬 파일 조회 (Phase 3)
router.get('/skills', (_req, res) => {
  res.status(501).json({ message: 'Phase 3에서 구현 예정' });
});

export default router;
