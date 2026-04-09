import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import os from 'node:os';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ingestDocument } from '@educlip/rag';
import {
  db,
  ragDocuments,
  heartbeatRuns,
  ewsRiskScores,
  counselingNotes,
  consultationBookings,
  conversationMessages,
  auditLogs,
  students,
  routines,
  routineTriggers,
  costEvents,
  budgetPolicies,
  modelPricing,
  attendanceLogs,
  instructorSkills,
  agents,
  eq,
  and,
  isNull,
  sql,
  desc,
  gte,
  lte,

} from '@educlip/db';
import { invalidateSkillCache, importSkillFromGitHub } from '../services/skill-injector.js';
import { hasCyclicParent } from '../services/agent-hierarchy.js';
import { ConnectorRegistry } from '../mcp/registry.js';
import { withAuditLog, logAgentChange } from '../mcp/audit.js';
import { invalidatePricingCache } from '../services/budget-guard.js';
import { getEwsThresholds, setEwsThresholds } from '../services/ews-thresholds.js';
import { getPortfolioSettings, setPortfolioSettings } from '../services/portfolio-settings-store.js';
import { triggerAgentManually, getHeartbeatStatus } from '../services/heartbeat.js';
import { sendSlackTestMessage } from '../services/slack-notifier.js';
import { slackTestLimiter } from '../middleware/rateLimiter.js';

const router: ReturnType<typeof Router> = Router();

// 모든 /admin/* 라우트에 인증 + admin 역할 전용 검증 적용
router.use(authenticate);
router.use(requireRole('admin'));

// ─── 보안 키 인메모리 저장소 (Phase 1) ────────────────────────────────────────
// process.env 업데이트를 통해 LLM 어댑터가 즉시 새 키를 사용할 수 있도록 함
// Phase 2 이후 DB 암호화 저장으로 전환 예정
const secretsStore = new Map<string, string>();

// multer: OS tmpdir 디스크 스토리지 — worker_threads 기반 ingestDocument()가 파일 경로를 요구함
// (memoryStorage()는 req.file.path = undefined → pipeline에서 ENOENT 발생)
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname);
      cb(null, `educlip-upload-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/markdown', 'text/plain'];
    const extAllowed = /\.(pdf|md|markdown|txt)$/i.test(file.originalname);
    if (allowed.includes(file.mimetype) || extAllowed) {
      cb(null, true);
    } else {
      cb(new Error('PDF, Markdown, 텍스트 파일만 업로드 가능합니다.'));
    }
  },
});

// institutionId는 JWT에서 추출 (DocumentManager UI가 전송하지 않음)
const documentUploadSchema = z.object({
  courseId: z.string().uuid().optional(),
});

// GET /admin/health — 관리자용 상세 헬스체크
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// GET /admin/documents — 등록된 교재 목록 조회 (소스 파일 단위로 그룹핑)
router.get('/documents', async (req, res) => {
  const { institutionId } = req.user!;

  // 청크 단위로 저장되므로 소스 파일명 기준으로 그룹핑 후 대표 id/createdAt 반환
  const docs = await db
    .select({
      id: sql<string>`MIN(${ragDocuments.id}::text)`,
      filename: ragDocuments.sourceFileName,
      createdAt: sql<string>`MIN(${ragDocuments.createdAt})`,
    })
    .from(ragDocuments)
    .where(
      and(
        eq(ragDocuments.institutionId, institutionId),
        isNull(ragDocuments.deletedAt),
      ),
    )
    .groupBy(ragDocuments.sourceFileName);

  res.json(
    docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      createdAt: d.createdAt
        ? new Date(d.createdAt).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
    })),
  );
});

// POST /admin/documents — 교재 업로드 및 RAG 임베딩 등록
// Content-Type: multipart/form-data, Body: file + courseId?(UUID)
router.post('/documents', upload.single('file'), async (req, res) => {
  const { institutionId } = req.user!;

  if (!req.file) {
    res.status(400).json({ error: '파일이 첨부되지 않았습니다.' });
    return;
  }

  const parsed = documentUploadSchema.safeParse(req.body);
  const courseId = parsed.success ? parsed.data.courseId : undefined;

  await ingestDocument({
    institutionId,
    courseId,
    fileName: req.file.originalname,
    filePath: req.file.path, // OS tmpdir 물리 파일 경로 (diskStorage)
  });

  // DocItem 형식으로 응답 (id: 업로드 세션 UUID, UI 목록 즉시 반영용)
  res.status(201).json({
    id: randomUUID(),
    filename: req.file.originalname,
    createdAt: new Date().toISOString().split('T')[0],
  });
});

// DELETE /admin/documents/:id — 소프트 삭제 (연결된 청크 전체)
// :id 는 GET /admin/documents 에서 반환된 MIN(id) — 소스 파일명 역참조에 사용
router.delete('/documents/:id', async (req, res) => {
  const { institutionId } = req.user!;
  const { id } = req.params;

  // chunk id로 소스 파일명 조회
  const rows = await db
    .select({ sourceFileName: ragDocuments.sourceFileName })
    .from(ragDocuments)
    .where(
      and(
        eq(ragDocuments.id, id),
        eq(ragDocuments.institutionId, institutionId),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    return;
  }

  // 해당 소스 파일의 모든 청크를 소프트 삭제
  await db
    .update(ragDocuments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(ragDocuments.sourceFileName, rows[0].sourceFileName),
        eq(ragDocuments.institutionId, institutionId),
      ),
    );

  res.status(204).end();
});

// GET /admin/secrets — 마스킹된 현재 보안 키 반환
router.get('/secrets', (_req, res) => {
  const mask = (v: string | undefined) =>
    v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '';

  res.json({
    openaiApiKey: mask(secretsStore.get('openaiApiKey')),
    anthropicApiKey: mask(secretsStore.get('anthropicApiKey')),
    slackWebhookUrl: secretsStore.get('slackWebhookUrl') ?? '',
  });
});

// PUT /admin/secrets — 보안 키 저장 (인메모리 + process.env 즉시 반영)
const secretsSchema = z.object({
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  slackWebhookUrl: z.union([z.string().url(), z.literal('')]).optional(),
});

router.put('/secrets', (req, res) => {
  const parsed = secretsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { openaiApiKey, anthropicApiKey, slackWebhookUrl } = parsed.data;

  if (openaiApiKey) {
    secretsStore.set('openaiApiKey', openaiApiKey);
    process.env.OPENAI_API_KEY = openaiApiKey;
  }
  if (anthropicApiKey) {
    secretsStore.set('anthropicApiKey', anthropicApiKey);
    process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  }
  if (slackWebhookUrl !== undefined) {
    secretsStore.set('slackWebhookUrl', slackWebhookUrl);
    process.env.SLACK_WEBHOOK_URL = slackWebhookUrl;
  }

  res.json({ message: '보안 키가 저장되었습니다.' });
});

// ── Heartbeat 스케줄러 관련 엔드포인트 (Phase 2-1) ──────────────────────────

// GET /admin/heartbeat/status — 스케줄러 현황 조회
router.get('/heartbeat/status', (_req, res) => {
  res.json(getHeartbeatStatus());
});

// GET /admin/heartbeat/runs — 최근 실행 이력 조회 (최대 50건)
router.get('/heartbeat/runs', async (req, res) => {
  const { institutionId } = req.user!;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);

  const runs = await db
    .select()
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.institutionId, institutionId))
    .orderBy(desc(heartbeatRuns.createdAt))
    .limit(limit);

  res.json(runs);
});

// POST /admin/heartbeat/trigger/:agentId — 특정 에이전트 수동 즉시 실행
const triggerSchema = z.object({ agentId: z.string().uuid() });

router.post('/heartbeat/trigger/:agentId', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = triggerSchema.safeParse(req.params);

  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 agentId 형식입니다.' });
    return;
  }

  const result = await triggerAgentManually(parsed.data.agentId, institutionId);

  if ('error' in result) {
    res.status(409).json(result);
    return;
  }

  res.status(202).json({ message: '에이전트 실행이 예약되었습니다.', ...result });
});

// PUT /admin/routines — 스케줄 설정 (Phase 2 GUI 연동 시 확장)
router.put('/routines', (_req, res) => {
  res.status(501).json({ message: 'Phase 2 GUI 스케줄 설정기 연동 시 구현 예정' });
});

// PUT /admin/budget — 예산 설정 (Phase 2)
router.put('/budget', (_req, res) => {
  res.status(501).json({ message: 'Phase 2에서 구현 예정' });
});

// ── 에이전트 CRUD (Phase 3-2) ─────────────────────────────────────────────────

const adapterConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'google']),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  role: z.enum(['orchestrator', 'ews_monitor', 'ai_instructor', 'ai_tutor', 'mental_care', 'portfolio_reviewer']),
  reportsTo: z.string().uuid().optional().nullable(),
  adapterConfig: adapterConfigSchema,
  fallbackAdapterConfig: adapterConfigSchema.optional().nullable(),
  systemPrompt: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

const updateAgentSchema = createAgentSchema.partial();

/**
 * GET /admin/agents
 * 기관 소속 전체 에이전트 목록 조회 (소프트 딜리트 제외)
 */
router.get('/agents', async (req, res) => {
  const institutionId = (req as any).user?.institutionId as string | undefined;
  if (!institutionId) {
    res.status(400).json({ error: 'institutionId가 없습니다.' });
    return;
  }

  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.institutionId, institutionId),
        isNull(agents.deletedAt),
      ),
    )
    .orderBy(agents.createdAt);

  res.json({ agents: rows });
});

/**
 * GET /admin/agents/:id
 * 특정 에이전트 조회
 */
router.get('/agents/:id', async (req, res) => {
  const institutionId = (req as any).user?.institutionId as string | undefined;
  const { id } = req.params;

  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, id),
        eq(agents.institutionId, institutionId!),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);

  if (!agent) {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }

  res.json({ agent });
});

/**
 * POST /admin/agents — 에이전트 등록 (Phase 3-2)
 */
router.post('/agents', async (req, res) => {
  const institutionId = (req as any).user?.institutionId as string | undefined;
  const actorId = (req as any).user?.userId as string | undefined;
  if (!institutionId) {
    res.status(400).json({ error: 'institutionId가 없습니다.' });
    return;
  }

  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { reportsTo, fallbackAdapterConfig, ...rest } = parsed.data;

  // ── [개선①] 순환 참조 사전 차단 ─────────────────────────────────────────
  if (reportsTo) {
    // 신규 에이전트는 아직 ID가 없으므로 agentId=null (자기-참조 불가, DB 레벨에서도 차단)
    const hasCycle = await hasCyclicParent(null, reportsTo, institutionId);
    if (hasCycle) {
      res.status(409).json({ error: '에이전트 계층에 순환 참조가 발생합니다. reportsTo 설정을 확인하세요.' });
      return;
    }
  }

  const [agent] = await db
    .insert(agents)
    .values({
      institutionId,
      ...rest,
      reportsTo: reportsTo ?? undefined,
      fallbackAdapterConfig: fallbackAdapterConfig ?? undefined,
    })
    .returning();

  // ── [개선③] 에이전트 생성 감사 로그 ──────────────────────────────────────
  void logAgentChange({
    institutionId,
    actorId: actorId ?? 'unknown',
    operation: 'create',
    agentId: agent.id,
    after: { name: agent.name, role: agent.role, reportsTo: agent.reportsTo },
    ipAddress: req.ip,
  });

  res.status(201).json({ agent });
});

/**
 * PUT /admin/agents/:id — 에이전트 설정 변경 (Phase 3-2)
 * adapterConfig, fallbackAdapterConfig, systemPrompt, isActive 등 부분 업데이트 지원
 */
router.put('/agents/:id', async (req, res) => {
  const institutionId = (req as any).user?.institutionId as string | undefined;
  const actorId = (req as any).user?.userId as string | undefined;
  const { id } = req.params;

  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { reportsTo, fallbackAdapterConfig, ...rest } = parsed.data;

  // ── [개선①] 순환 참조 사전 차단 ─────────────────────────────────────────
  if (reportsTo) {
    const hasCycle = await hasCyclicParent(id, reportsTo, institutionId!);
    if (hasCycle) {
      res.status(409).json({ error: '에이전트 계층에 순환 참조가 발생합니다. reportsTo 설정을 확인하세요.' });
      return;
    }
  }

  // ── [개선③] 변경 전 스냅샷 조회 ─────────────────────────────────────────
  const [before] = await db
    .select({ name: agents.name, role: agents.role, reportsTo: agents.reportsTo, isActive: agents.isActive })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!), isNull(agents.deletedAt)))
    .limit(1);

  const updateValues: Record<string, unknown> = {
    ...rest,
    updatedAt: new Date(),
  };
  if (reportsTo !== undefined) updateValues.reportsTo = reportsTo;
  if (fallbackAdapterConfig !== undefined) updateValues.fallbackAdapterConfig = fallbackAdapterConfig;

  const [updated] = await db
    .update(agents)
    .set(updateValues)
    .where(
      and(
        eq(agents.id, id),
        eq(agents.institutionId, institutionId!),
        isNull(agents.deletedAt),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }

  // ── [개선③] 에이전트 변경 감사 로그 ──────────────────────────────────────
  void logAgentChange({
    institutionId: institutionId!,
    actorId: actorId ?? 'unknown',
    operation: 'update',
    agentId: id,
    before: before
      ? { name: before.name, role: before.role, reportsTo: before.reportsTo, isActive: before.isActive }
      : null,
    after: { name: updated.name, role: updated.role, reportsTo: updated.reportsTo, isActive: updated.isActive },
    ipAddress: req.ip,
  });

  res.json({ agent: updated });
});

/**
 * DELETE /admin/agents/:id — 에이전트 소프트 딜리트
 */
router.delete('/agents/:id', async (req, res) => {
  const institutionId = (req as any).user?.institutionId as string | undefined;
  const actorId = (req as any).user?.userId as string | undefined;
  const { id } = req.params;

  const [deleted] = await db
    .update(agents)
    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(agents.id, id),
        eq(agents.institutionId, institutionId!),
        isNull(agents.deletedAt),
      ),
    )
    .returning({ id: agents.id, name: agents.name, role: agents.role });

  if (!deleted) {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }

  // ── [개선③] 에이전트 삭제 감사 로그 ──────────────────────────────────────
  void logAgentChange({
    institutionId: institutionId!,
    actorId: actorId ?? 'unknown',
    operation: 'delete',
    agentId: deleted.id,
    before: { name: deleted.name, role: deleted.role },
    ipAddress: req.ip,
  });

  res.json({ deleted: true, id: deleted.id });
});

// ── 스킬 파일 CRUD (Phase 3-1) ───────────────────────────────────────────────

const createSkillSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
  courseId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  isActive: z.boolean().default(true),
});

const updateSkillSchema = z.object({
  title: z.string().min(1).optional(),
  markdown: z.string().min(1).optional(),
  courseId: z.string().uuid().nullable().optional(),
  agentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const importGitHubSkillSchema = z.object({
  rawUrl: z.string().url(),
  title: z.string().min(1),
  courseId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
});

/**
 * GET /admin/skills
 * 기관 내 활성 스킬 목록을 조회합니다.
 * 쿼리: ?agentId=<uuid>&courseId=<uuid>
 */
router.get('/skills', async (req, res) => {
  const { institutionId } = req.user!;
  const agentId = req.query['agentId'] as string | undefined;
  const courseId = req.query['courseId'] as string | undefined;

  const conditions = [
    eq(instructorSkills.institutionId, institutionId),
    isNull(instructorSkills.deletedAt),
  ];
  if (agentId) conditions.push(eq(instructorSkills.agentId, agentId));
  if (courseId) conditions.push(eq(instructorSkills.courseId, courseId));

  const rows = await db
    .select()
    .from(instructorSkills)
    .where(and(...conditions))
    .orderBy(desc(instructorSkills.createdAt));

  res.json({ skills: rows });
});

/**
 * POST /admin/skills
 * 새 스킬 파일을 등록합니다.
 */
router.post('/skills', async (req, res) => {
  const parsed = createSkillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId } = req.user!;
  const { title, markdown, courseId, agentId, isActive } = parsed.data;

  const [skill] = await db
    .insert(instructorSkills)
    .values({ institutionId, title, markdown, courseId, agentId, isActive })
    .returning();

  if (agentId) invalidateSkillCache(agentId);

  res.status(201).json({ skill });
});

/**
 * PUT /admin/skills/:id
 * 스킬 파일을 수정하고 캐시를 무효화합니다 (핫 리로드).
 */
router.put('/skills/:id', async (req, res) => {
  const { id } = req.params;
  const parsed = updateSkillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId } = req.user!;

  const [existing] = await db
    .select({ id: instructorSkills.id, agentId: instructorSkills.agentId })
    .from(instructorSkills)
    .where(
      and(
        eq(instructorSkills.id, id),
        eq(instructorSkills.institutionId, institutionId),
        isNull(instructorSkills.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: '스킬을 찾을 수 없습니다.' });
    return;
  }

  const patch = { ...parsed.data, updatedAt: new Date() };

  const [updated] = await db
    .update(instructorSkills)
    .set(patch)
    .where(eq(instructorSkills.id, id))
    .returning();

  // 기존 agentId와 새 agentId 모두 캐시 무효화
  if (existing.agentId) invalidateSkillCache(existing.agentId);
  if (parsed.data.agentId && parsed.data.agentId !== existing.agentId) {
    invalidateSkillCache(parsed.data.agentId);
  }

  res.json({ skill: updated });
});

/**
 * DELETE /admin/skills/:id
 * 스킬 파일을 소프트 딜리트합니다 (sourceRef 이력 보존).
 */
router.delete('/skills/:id', async (req, res) => {
  const { id } = req.params;
  const { institutionId } = req.user!;

  const [existing] = await db
    .select({ id: instructorSkills.id, agentId: instructorSkills.agentId })
    .from(instructorSkills)
    .where(
      and(
        eq(instructorSkills.id, id),
        eq(instructorSkills.institutionId, institutionId),
        isNull(instructorSkills.deletedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: '스킬을 찾을 수 없습니다.' });
    return;
  }

  // H-1: 에이전트가 이 스킬을 현재 사용 중이면 409 반환
  if (existing.agentId) {
    const [linkedAgent] = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, existing.agentId))
      .limit(1);

    res.status(409).json({
      error: `이 스킬 파일은 현재 '${linkedAgent?.name ?? '에이전트'}' 에 사용 중입니다. 에이전트와의 연결을 먼저 해제해 주세요.`,
      agentId: existing.agentId,
      agentName: linkedAgent?.name ?? null,
    });
    return;
  }

  await db
    .update(instructorSkills)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(instructorSkills.id, id));

  if (existing.agentId) invalidateSkillCache(existing.agentId);

  res.json({ message: '스킬이 삭제되었습니다.', id });
});

/**
 * POST /admin/skills/import-github
 * GitHub Raw URL에서 마크다운을 가져와 스킬로 등록합니다.
 * sourceRef에 Git ref(커밋 해시 또는 브랜치명)를 기록합니다.
 */
router.post('/skills/import-github', async (req, res) => {
  const parsed = importGitHubSkillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId } = req.user!;
  const { rawUrl, title, courseId, agentId } = parsed.data;

  let imported: { markdown: string; sourceRef: string; sourceUrl: string };
  try {
    imported = await importSkillFromGitHub(rawUrl);
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
    return;
  }

  const [skill] = await db
    .insert(instructorSkills)
    .values({
      institutionId,
      title,
      markdown: imported.markdown,
      sourceRef: imported.sourceRef,
      sourceUrl: imported.sourceUrl,
      courseId,
      agentId,
      isActive: true,
    })
    .returning();

  if (agentId) invalidateSkillCache(agentId);

  res.status(201).json({ skill });
});

// ── MCP 외부 시스템 연동 API (Phase 1-3) ────────────────────────────────

const connectorPingSchema = z.object({
  type: z.enum(['lms', 'attendance']),
});

/**
 * POST /admin/connectors/ping
 * LMS / 출결 시스템 연결 상태를 확인합니다. (환경변수 기반)
 * Phase 2 이후 DB 기반 커넥터 설정으로 전환 예정.
 */
router.post('/connectors/ping', async (req, res) => {
  const parsed = connectorPingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId, sub: actorId } = req.user!;
  const { type } = parsed.data;

  const connector = type === 'lms'
    ? ConnectorRegistry.getLms(institutionId)
    : ConnectorRegistry.getAttendance(institutionId);

  if (!connector) {
    res.status(503).json({
      error: `${type.toUpperCase()} 커넥터가 설정되지 않았습니다. 환경변수를 확인하세요.`,
      required: type === 'lms'
        ? ['LMS_BASE_URL', 'LMS_API_KEY']
        : ['ATTENDANCE_BASE_URL', 'ATTENDANCE_API_KEY'],
    });
    return;
  }

  const result = await withAuditLog(
    () => connector.ping(),
    { institutionId, actorId, actorType: 'admin', action: 'mcp_connector_call', resourceType: type },
  );

  res.json({ type, ...result });
});

const syncLmsSchema = z.object({
  courseId: z.string().min(1),
  studentId: z.string().optional(),
});

/**
 * POST /admin/connectors/lms/sync
 * LMS에서 강의 진도 및 퀴즈 점수를 가져옵니다.
 * (EWS Phase 2에서 Heartbeat 스케줄로 자동화됩니다)
 */
router.post('/connectors/lms/sync', async (req, res) => {
  const parsed = syncLmsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId, sub: actorId } = req.user!;
  const { courseId, studentId } = parsed.data;
  const lms = ConnectorRegistry.getLms(institutionId);

  if (!lms) {
    res.status(503).json({ error: 'LMS 커넥터가 설정되지 않았습니다.' });
    return;
  }

  const [progress, quizScores] = await Promise.all([
    withAuditLog(
      () => lms.getCourseProgress(courseId, studentId),
      { institutionId, actorId, actorType: 'admin', action: 'mcp_connector_call', resourceType: 'lms', resourceId: courseId },
    ),
    withAuditLog(
      () => lms.getQuizScores(courseId, studentId),
      { institutionId, actorId, actorType: 'admin', action: 'mcp_connector_call', resourceType: 'lms', resourceId: courseId },
    ),
  ]);

  res.json({ courseId, progressCount: progress.length, quizCount: quizScores.length, progress, quizScores });
});

const syncAttendanceSchema = z.object({
  courseId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.'),
  studentId: z.string().optional(),
});

/**
 * POST /admin/connectors/attendance/sync
 * 출결 시스템에서 특정 기간의 출결 기록을 가져옵니다.
 */
router.post('/connectors/attendance/sync', async (req, res) => {
  const parsed = syncAttendanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId, sub: actorId } = req.user!;
  const { courseId, from, to, studentId } = parsed.data;
  const attendance = ConnectorRegistry.getAttendance(institutionId);

  if (!attendance) {
    res.status(503).json({ error: '출결 커넥터가 설정되지 않았습니다.' });
    return;
  }

  const records = await withAuditLog(
    () => attendance.getAttendanceRecords(courseId, from, to, studentId),
    { institutionId, actorId, actorType: 'admin', action: 'mcp_connector_call', resourceType: 'attendance', resourceId: courseId },
  );

  res.json({ courseId, from, to, count: records.length, records });
});

// ─── EWS 위험 점수 API (Phase 2-2) ─────────────────────────────────────────

// GET /admin/ews/scores — 기관 내 최근 EWS 위험 점수 목록 조회
// 쿼리: ?limit=50&minScore=60&courseId=<uuid>&from=YYYY-MM-DD
router.get('/ews/scores', async (req, res) => {
  const { institutionId } = req.user!;

  const limitRaw = parseInt(req.query['limit'] as string ?? '50', 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 50 : Math.min(limitRaw, 200);
  const minScore = parseInt(req.query['minScore'] as string ?? '0', 10);
  const courseId = req.query['courseId'] as string | undefined;
  const from = req.query['from'] as string | undefined;

  // 기관 소속 수강생 UUID 목록 조회 (institution 경계 강제)
  const institutionStudents = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
      ),
    );

  if (institutionStudents.length === 0) {
    res.json({ count: 0, scores: [] });
    return;
  }

  const studentIds = institutionStudents.map((s) => s.id);

  // ews_risk_scores 필터 조건 조립
  const conditions = [
    sql`${ewsRiskScores.studentId} = ANY(ARRAY[${sql.raw(studentIds.map(() => '?').join(','))}]::uuid[])`,
    sql`${ewsRiskScores.totalScore} >= ${minScore}`,
  ];
  if (courseId) conditions.push(eq(ewsRiskScores.courseId, courseId));
  if (from) conditions.push(gte(ewsRiskScores.calculatedAt, new Date(from)));

  const scores = await db
    .select()
    .from(ewsRiskScores)
    .where(and(...conditions))
    .orderBy(desc(ewsRiskScores.calculatedAt), desc(ewsRiskScores.totalScore))
    .limit(limit);

  res.json({ count: scores.length, scores });
});

// PUT /admin/ews/scores/:scoreId/feedback — Human-in-the-loop 오탐 피드백
// 강사가 "이 수강생은 위험하지 않습니다(오탐)" 표시 → 임계치 보정 기반 데이터 수집
const feedbackBodySchema = z.object({
  isFalsePositive: z.boolean(),
  instructorNote: z.string().max(500).optional(),
});

router.put('/ews/scores/:scoreId/feedback', async (req, res) => {
  const { institutionId } = req.user!;
  const { scoreId } = req.params as { scoreId: string };

  const parsed = feedbackBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 피드백 데이터', details: parsed.error.flatten() });
    return;
  }

  // 기관 경계 검사: 해당 score가 이 기관 수강생 소속인지 확인
  const [existing] = await db
    .select({ id: ewsRiskScores.id, studentId: ewsRiskScores.studentId })
    .from(ewsRiskScores)
    .where(eq(ewsRiskScores.id, scoreId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'EWS 점수 기록을 찾을 수 없습니다.' });
    return;
  }

  const [ownerStudent] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, existing.studentId),
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
      ),
    )
    .limit(1);

  if (!ownerStudent) {
    res.status(403).json({ error: '다른 기관의 EWS 점수에 접근할 수 없습니다.' });
    return;
  }

  await db
    .update(ewsRiskScores)
    .set({
      isFalsePositive: parsed.data.isFalsePositive,
      instructorNote: parsed.data.instructorNote ?? null,
    })
    .where(eq(ewsRiskScores.id, scoreId));

  // 개선③: 허위 양성 피드백 감사 로그 기록
  await db.insert(auditLogs).values({
    institutionId,
    actorId: req.user!.sub,
    actorType: 'instructor',
    action: 'write',
    resourceType: 'ews_feedback',
    resourceId: scoreId,
    metadata: {
      isFalsePositive: parsed.data.isFalsePositive,
      hasNote: !!parsed.data.instructorNote,
    },
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true, scoreId, isFalsePositive: parsed.data.isFalsePositive });
});

// POST /admin/ews/counseling — 강사 상담 기록 입력
// 상담 이력을 직접 추가 (EWS 15% 반영 데이터)
const counselingBodySchema = z.object({
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  summary: z.string().max(1000).optional(),
  counseledAt: z.string().datetime().optional(),
});

router.post('/ews/counseling', async (req, res) => {
  const { institutionId } = req.user!;

  const parsed = counselingBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 상담 데이터', details: parsed.error.flatten() });
    return;
  }

  // 기관 경계 검사: 수강생이 이 기관 소속인지 확인
  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, parsed.data.studentId),
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
      ),
    )
    .limit(1);

  if (!student) {
    res.status(403).json({ error: '기관 소속 수강생이 아닙니다.' });
    return;
  }

  const [note] = await db
    .insert(counselingNotes)
    .values({
      studentId: parsed.data.studentId,
      courseId: parsed.data.courseId,
      sentiment: parsed.data.sentiment,
      summary: parsed.data.summary ?? null,
      counseledAt: parsed.data.counseledAt ? new Date(parsed.data.counseledAt) : new Date(),
    })
    .returning();

  // 개선③: 강사 수동 개입 감사 로그 기록 (Human-in-the-loop 추적)
  await db.insert(auditLogs).values({
    institutionId,
    actorId: req.user!.sub,
    actorType: 'instructor',
    action: 'write',
    resourceType: 'ews_counseling',
    resourceId: note.id,
    metadata: {
      studentId: parsed.data.studentId,
      sentiment: parsed.data.sentiment,
      hasSummary: !!parsed.data.summary,
    },
    ipAddress: req.ip ?? null,
  });

  res.status(201).json({ success: true, note });
});

// ─── EWS 알림 에스컬레이션 API (Phase 2-3/2-4) ─────────────────────────────

// POST /admin/ews/slack-test — Slack Webhook 연결 테스트 메시지 발송
const slackTestSchema = z.object({
  webhookUrl: z.string().url('유효한 Slack Webhook URL을 입력하세요.').optional(),
});

router.post('/ews/slack-test', slackTestLimiter, async (req, res) => {
  const parsed = slackTestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  // body에 webhookUrl이 있으면 그것을 사용, 없으면 현재 설정된 process.env 사용
  const webhookUrl = parsed.data.webhookUrl ?? process.env['SLACK_WEBHOOK_URL']?.trim();

  if (!webhookUrl) {
    res.status(422).json({
      error: 'Slack Webhook URL이 설정되어 있지 않습니다. PUT /admin/secrets 에서 slackWebhookUrl을 설정하거나 요청 본문에 webhookUrl을 포함하세요.',
    });
    return;
  }

  await sendSlackTestMessage(webhookUrl);
  res.json({ success: true, message: 'Slack 테스트 메시지가 성공적으로 발송되었습니다.' });
});

// POST /admin/ews/consultations — 상담 예약 즉시 생성 (강사 Quick Action용)
const createConsultationSchema = z.object({
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
  triggeredByScoreId: z.string().uuid().optional(),
});

router.post('/ews/consultations', async (req, res) => {
  const { institutionId } = req.user!;

  const parsed = createConsultationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  // 기관 경계 검사: 수강생이 이 기관 소속인지 확인
  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, parsed.data.studentId),
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
      ),
    )
    .limit(1);

  if (!student) {
    res.status(403).json({ error: '기관 소속 수강생이 아닙니다.' });
    return;
  }

  const [booking] = await db
    .insert(consultationBookings)
    .values({
      institutionId,
      studentId: parsed.data.studentId,
      courseId: parsed.data.courseId,
      triggeredByScoreId: parsed.data.triggeredByScoreId ?? null,
      status: 'pending',
    })
    .returning();

  // 개선③: 상담 예약 즉시 생성 감사 로그 기록
  await db.insert(auditLogs).values({
    institutionId,
    actorId: req.user!.sub,
    actorType: 'instructor',
    action: 'write',
    resourceType: 'ews_consultation',
    resourceId: booking.id,
    metadata: {
      studentId: parsed.data.studentId,
      courseId: parsed.data.courseId,
      triggeredByScoreId: parsed.data.triggeredByScoreId ?? null,
    },
    ipAddress: req.ip ?? null,
  });

  res.status(201).json({ success: true, booking });
});

// GET /admin/ews/consultations — 상담 예약 목록 조회
// 쿼리: ?limit=50&status=pending&studentId=<uuid>
router.get('/ews/consultations', async (req, res) => {
  const { institutionId } = req.user!;

  const limitRaw = parseInt(req.query['limit'] as string ?? '50', 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 50 : Math.min(limitRaw, 200);
  const statusFilter = req.query['status'] as string | undefined;
  const studentIdFilter = req.query['studentId'] as string | undefined;

  const conditions = [eq(consultationBookings.institutionId, institutionId)];
  if (statusFilter && ['pending', 'confirmed', 'completed', 'cancelled'].includes(statusFilter)) {
    conditions.push(
      eq(consultationBookings.status, statusFilter as 'pending' | 'confirmed' | 'completed' | 'cancelled'),
    );
  }
  if (studentIdFilter) {
    conditions.push(eq(consultationBookings.studentId, studentIdFilter));
  }

  const bookings = await db
    .select()
    .from(consultationBookings)
    .where(and(...conditions))
    .orderBy(desc(consultationBookings.requestedAt))
    .limit(limit);

  res.json({ count: bookings.length, bookings });
});

// PUT /admin/ews/consultations/:bookingId — 상담 예약 상태 변경
// 원장/상담사가 pending → confirmed / completed / cancelled 처리
const bookingUpdateSchema = z.object({
  status: z.enum(['confirmed', 'completed', 'cancelled']),
  notes: z.string().max(1000).optional(),
});

router.put('/ews/consultations/:bookingId', async (req, res) => {
  const { institutionId } = req.user!;
  const { bookingId } = req.params as { bookingId: string };

  const parsed = bookingUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const [existing] = await db
    .select({ id: consultationBookings.id, institutionId: consultationBookings.institutionId })
    .from(consultationBookings)
    .where(eq(consultationBookings.id, bookingId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: '상담 예약을 찾을 수 없습니다.' });
    return;
  }

  if (existing.institutionId !== institutionId) {
    res.status(403).json({ error: '다른 기관의 상담 예약에 접근할 수 없습니다.' });
    return;
  }

  const [updated] = await db
    .update(consultationBookings)
    .set({
      status: parsed.data.status,
      notes: parsed.data.notes ?? null,
      completedAt: parsed.data.status === 'completed' ? new Date() : undefined,
    })
    .where(eq(consultationBookings.id, bookingId))
    .returning();

  res.json({ success: true, booking: updated });
});

// ─── 멘탈케어 메시지 읽음 확인 API (Phase 2-4 개선) ──────────────────────────

// GET /admin/ews/mental-care-messages — 멘탈케어 미확인 메시지 목록 조회
router.get('/ews/mental-care-messages', async (req, res) => {
  const { user } = res.locals as { user: { institutionId: string } };
  const institutionId = user.institutionId;

  const unreadOnly = req.query['unread'] !== 'false'; // 기본: 미읽음만

  const rows = await db
    .select({
      id:          conversationMessages.id,
      studentId:   conversationMessages.studentId,
      courseId:    conversationMessages.courseId,
      content:     conversationMessages.content,
      isAdminRead: conversationMessages.isAdminRead,
      createdAt:   conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .innerJoin(students, eq(students.id, conversationMessages.studentId))
    .where(
      and(
        eq(students.institutionId, institutionId),
        eq(conversationMessages.role, 'assistant'),
        sql`${conversationMessages.llmMetaJson} IS NOT NULL OR ${conversationMessages.content} IS NOT NULL`,
        ...(unreadOnly ? [eq(conversationMessages.isAdminRead, false)] : []),
      ),
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(100);

  res.json({ messages: rows });
});

// PATCH /admin/ews/mental-care-messages/:messageId/read — 읽음 처리
router.patch('/ews/mental-care-messages/:messageId/read', async (req, res) => {
  const { user } = res.locals as { user: { institutionId: string } };
  const institutionId = user.institutionId;
  const { messageId } = req.params;

  // 기관 소속 메시지인지 확인 (수강생 → 기관 조인)
  const [existing] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .innerJoin(students, eq(students.id, conversationMessages.studentId))
    .where(
      and(
        eq(conversationMessages.id, messageId),
        eq(students.institutionId, institutionId),
      ),
    )
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: '메시지를 찾을 수 없거나 접근 권한이 없습니다.' });
    return;
  }

  await db
    .update(conversationMessages)
    .set({ isAdminRead: true })
    .where(eq(conversationMessages.id, messageId));

  res.json({ success: true });
});

// PATCH /admin/ews/mental-care-messages/read-all — 기관 전체 읽음 일괄 처리
router.patch('/ews/mental-care-messages/read-all', async (req, res) => {
  const { user } = res.locals as { user: { institutionId: string } };
  const institutionId = user.institutionId;

  const result = await db.execute<{ count: string }>(sql`
    UPDATE conversation_messages cm
    SET is_admin_read = true
    FROM students s
    WHERE cm.student_id = s.id
      AND s.institution_id = ${institutionId}
      AND cm.role = 'assistant'
      AND cm.is_admin_read = false
  `);

  res.json({ success: true, updatedCount: result.length });
});

// ─── 대시보드 KPI ────────────────────────────────────────────────────────────

// GET /admin/dashboard — 원장 대시보드 KPI 요약
// 반환: 총 수강생, 위험 수강생 수, 이번 달 AI 비용 합계, 최근 위험 수강생 목록
router.get('/dashboard', async (req, res) => {
  const { institutionId } = req.user!;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 총 활성 수강생
  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(students)
    .where(and(eq(students.institutionId, institutionId), isNull(students.deletedAt)));

  // 위험 수강생 (최근 30일 내 totalScore >= 60인 uniqueStudent)
  const riskRows = await db
    .select({
      studentId: ewsRiskScores.studentId,
      totalScore: ewsRiskScores.totalScore,
      calculatedAt: ewsRiskScores.calculatedAt,
    })
    .from(ewsRiskScores)
    .innerJoin(students, eq(ewsRiskScores.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        gte(ewsRiskScores.totalScore, 60),
        gte(ewsRiskScores.calculatedAt, new Date(now.getTime() - 30 * 86400_000)),
        isNull(ewsRiskScores.isFalsePositive),
      ),
    )
    .orderBy(desc(ewsRiskScores.totalScore));

  // 이번 달 AI 비용 합계 (cost_events)
  const [costRow] = await db
    .select({ total: sql<number>`coalesce(sum(${costEvents.costUsd}), 0)::float` })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.institutionId, institutionId),
        gte(costEvents.createdAt, monthStart),
      ),
    );

  // 이번 달 출결율 집계
  const [attRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`sum(case when ${attendanceLogs.status} = 'present' or ${attendanceLogs.status} = 'late' then 1 else 0 end)::int`,
    })
    .from(attendanceLogs)
    .innerJoin(students, eq(attendanceLogs.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        gte(attendanceLogs.attendanceDate, monthStart.toISOString().split('T')[0]),
        isNull(attendanceLogs.deletedAt),
      ),
    );

  const attendanceRate =
    attRow && attRow.total > 0
      ? Math.round(((attRow.present ?? 0) / attRow.total) * 100)
      : null;

  // 중복 제거 후 위험 수강생 수
  const uniqueRiskStudentIds = new Set(riskRows.map((r) => r.studentId));

  res.json({
    totalStudents: totalRow?.count ?? 0,
    atRiskCount: uniqueRiskStudentIds.size,
    monthlyAiCostUsd: costRow?.total ?? 0,
    attendanceRate,
    recentRiskStudents: riskRows.slice(0, 10).map((r) => ({
      studentId: r.studentId,
      totalScore: r.totalScore,
      calculatedAt: r.calculatedAt,
    })),
  });
});

// ─── 루틴(스케줄) 관리 ───────────────────────────────────────────────────────

// GET /admin/routines — 기관 내 루틴 + 트리거 목록 조회
router.get('/routines', async (req, res) => {
  const { institutionId } = req.user!;

  const rows = await db
    .select({
      id: routines.id,
      name: routines.name,
      description: routines.description,
      isActive: routines.isActive,
      agentId: routines.agentId,
      courseId: routines.courseId,
      createdAt: routines.createdAt,
      updatedAt: routines.updatedAt,
      triggerId: routineTriggers.id,
      triggerKind: routineTriggers.kind,
      cronExpression: routineTriggers.cronExpression,
      webhookEvent: routineTriggers.webhookEvent,
      triggerIsActive: routineTriggers.isActive,
    })
    .from(routines)
    .leftJoin(routineTriggers, eq(routineTriggers.routineId, routines.id))
    .where(eq(routines.institutionId, institutionId))
    .orderBy(routines.name);

  // 루틴 단위로 그룹핑 (트리거는 배열)
  const routineMap = new Map<string, {
    id: string; name: string; description: string | null;
    isActive: boolean; agentId: string; courseId: string | null;
    createdAt: Date; updatedAt: Date;
    triggers: { id: string; kind: string; cronExpression: string | null; webhookEvent: string | null; isActive: boolean }[];
  }>();

  for (const row of rows) {
    if (!routineMap.has(row.id)) {
      routineMap.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        isActive: row.isActive,
        agentId: row.agentId,
        courseId: row.courseId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        triggers: [],
      });
    }
    if (row.triggerId) {
      routineMap.get(row.id)!.triggers.push({
        id: row.triggerId,
        kind: row.triggerKind!,
        cronExpression: row.cronExpression,
        webhookEvent: row.webhookEvent,
        isActive: row.triggerIsActive!,
      });
    }
  }

  res.json(Array.from(routineMap.values()));
});

const routineUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  cronExpression: z.string().optional(),
});

// PUT /admin/routines/:id — 루틴 활성/비활성 + 크론 표현식 변경
router.put('/routines/:id', async (req, res) => {
  const { institutionId } = req.user!;
  const { id } = req.params;

  const parsed = routineUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  // 기관 소속 확인
  const [routine] = await db
    .select({ id: routines.id })
    .from(routines)
    .where(and(eq(routines.id, id), eq(routines.institutionId, institutionId)))
    .limit(1);

  if (!routine) {
    res.status(404).json({ error: '루틴을 찾을 수 없습니다.' });
    return;
  }

  const { isActive, cronExpression } = parsed.data;

  if (isActive !== undefined) {
    await db
      .update(routines)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(routines.id, id));
  }

  if (cronExpression !== undefined) {
    // cron 트리거 업데이트 (없으면 패스 — UI가 트리거 있는 루틴만 편집)
    await db
      .update(routineTriggers)
      .set({ cronExpression })
      .where(and(eq(routineTriggers.routineId, id), eq(routineTriggers.kind, 'cron')));
  }

  res.json({ success: true });
});

// ─── EWS 임계치 관리 ─────────────────────────────────────────────────────────

// GET /admin/thresholds — 현재 EWS 임계치 조회
router.get('/thresholds', (req, res) => {
  const { institutionId } = req.user!;
  res.json(getEwsThresholds(institutionId));
});

const thresholdsSchema = z.object({
  warningThreshold:  z.number().int().min(0).max(100).optional(),
  highRiskThreshold: z.number().int().min(0).max(100).optional(),
  criticalThreshold: z.number().int().min(0).max(100).optional(),
  slackEscalateScore: z.number().int().min(0).max(100).optional(),
});

// PUT /admin/thresholds — EWS 임계치 변경
router.put('/thresholds', async (req, res) => {
  const { institutionId } = req.user!;

  const parsed = thresholdsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const updated = await setEwsThresholds(institutionId, parsed.data);
  res.json(updated);
});

// ─── 예산 관리 API (Phase 2-7) ───────────────────────────────────────────────

// GET /admin/budget — 이번 달 소비 현황 조회 (전체 + 에이전트별 breakdown)
router.get('/budget', async (req, res) => {
  const { institutionId } = req.user!;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // 이번 달 전체 비용 + 에이전트별 breakdown
  const rows = await db
    .select({
      agentId: costEvents.agentId,
      model: costEvents.model,
      provider: costEvents.provider,
      totalCostUsd: sql<number>`SUM(${costEvents.costUsd})::float`,
      totalInputTokens: sql<number>`SUM(${costEvents.promptTokens})::int`,
      totalOutputTokens: sql<number>`SUM(${costEvents.completionTokens})::int`,
      callCount: sql<number>`COUNT(*)::int`,
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.institutionId, institutionId),
        gte(costEvents.createdAt, monthStart),
        lte(costEvents.createdAt, monthEnd),
      ),
    )
    .groupBy(costEvents.agentId, costEvents.model, costEvents.provider)
    .orderBy(sql`SUM(${costEvents.costUsd}) DESC`);

  const totalCostUsd = rows.reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0);

  // 기관 전체 정책 조회 (limitUsd 게이지 계산용)
  const [globalPolicy] = await db
    .select()
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.institutionId, institutionId),
        isNull(budgetPolicies.agentId),
        eq(budgetPolicies.isActive, 'true'),
      ),
    )
    .limit(1);

  res.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    totalCostUsd,
    limitUsd: globalPolicy?.limitUsd ?? null,
    alertThresholdPct: globalPolicy?.alertThresholdPct ?? 80,
    onExceed: globalPolicy?.onExceed ?? 'pause',
    usagePct: globalPolicy ? (totalCostUsd / globalPolicy.limitUsd) * 100 : null,
    breakdown: rows,
  });
});

// GET /admin/budget/policies — 예산 정책 목록 조회
router.get('/budget/policies', async (req, res) => {
  const { institutionId } = req.user!;

  const policies = await db
    .select()
    .from(budgetPolicies)
    .where(eq(budgetPolicies.institutionId, institutionId))
    .orderBy(desc(budgetPolicies.createdAt));

  res.json({ policies });
});

// PUT /admin/budget — 기관 전체 예산 정책 upsert
const budgetPolicySchema = z.object({
  limitUsd: z.number().positive(),
  period: z.enum(['monthly', 'weekly', 'daily']).default('monthly'),
  alertThresholdPct: z.number().int().min(1).max(99).default(80),
  onExceed: z.enum(['pause', 'alert_only']).default('pause'),
});

router.put('/budget', async (req, res) => {
  const { institutionId } = req.user!;

  const parsed = budgetPolicySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { limitUsd, period, alertThresholdPct, onExceed } = parsed.data;

  // 기존 기관 전체(agentId IS NULL) 정책 존재 여부 확인
  const [existing] = await db
    .select({ id: budgetPolicies.id })
    .from(budgetPolicies)
    .where(
      and(
        eq(budgetPolicies.institutionId, institutionId),
        isNull(budgetPolicies.agentId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(budgetPolicies)
      .set({ limitUsd, period, alertThresholdPct, onExceed, isActive: 'true', updatedAt: new Date() })
      .where(eq(budgetPolicies.id, existing.id));
  } else {
    await db.insert(budgetPolicies).values({
      institutionId,
      limitUsd,
      period,
      alertThresholdPct,
      onExceed,
      isActive: 'true',
    });
  }

  res.json({ success: true, limitUsd, period, alertThresholdPct, onExceed });
});

// GET /admin/budget/cost-events — 최근 비용 이벤트 목록 (최대 100건)
router.get('/budget/cost-events', async (req, res) => {
  const { institutionId } = req.user!;
  const limit = Math.min(Number(req.query['limit'] ?? 100), 200);

  const events = await db
    .select({
      id: costEvents.id,
      agentId: costEvents.agentId,
      provider: costEvents.provider,
      model: costEvents.model,
      promptTokens: costEvents.promptTokens,
      completionTokens: costEvents.completionTokens,
      costUsd: costEvents.costUsd,
      createdAt: costEvents.createdAt,
    })
    .from(costEvents)
    .where(eq(costEvents.institutionId, institutionId))
    .orderBy(desc(costEvents.createdAt))
    .limit(limit);

  res.json({ events });
});

// ── 개선④ 모델 단가 관리 API ──────────────────────────────────────────────────

// GET /admin/budget/pricing — 모델별 단가 목록 조회
router.get('/budget/pricing', async (_req, res) => {
  const rows = await db
    .select()
    .from(modelPricing)
    .orderBy(modelPricing.provider, modelPricing.model);
  res.json({ pricing: rows });
});

// PUT /admin/budget/pricing — 단가 upsert (등록 또는 수정)
const pricingSchema = z.object({
  provider:    z.string().min(1).max(50),
  model:       z.string().min(1).max(100),
  inputPer1k:  z.number().nonnegative(),
  outputPer1k: z.number().nonnegative(),
  isActive:    z.boolean().default(true),
});

router.put('/budget/pricing', async (req, res) => {
  const parsed = pricingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { provider, model, inputPer1k, outputPer1k, isActive } = parsed.data;

  const [row] = await db
    .insert(modelPricing)
    .values({ provider, model, inputPer1k, outputPer1k, isActive })
    .onConflictDoUpdate({
      target: [modelPricing.provider, modelPricing.model],
      set: { inputPer1k, outputPer1k, isActive, updatedAt: new Date() },
    })
    .returning();

  // 단가 캐시 즉시 무효화 — 다음 LLM 호출부터 새 단가 적용
  invalidatePricingCache();

  res.status(200).json({ pricing: row });
});

// DELETE /admin/budget/pricing/:id — 단가 비활성화 (소프트 삭제)
router.delete('/budget/pricing/:id', async (req, res) => {
  const { id } = req.params;

  const [row] = await db
    .update(modelPricing)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(modelPricing.id, id))
    .returning({ id: modelPricing.id });

  if (!row) {
    res.status(404).json({ error: 'pricing entry not found' });
    return;
  }

  invalidatePricingCache();
  res.status(200).json({ deleted: id });
});

// ── 포트폴리오 설정 (공유 in-memory 스토어, 기관별) ────────────────────────────
// portfolio-settings-store.ts 에서 getPortfolioSettings / setPortfolioSettings 사용
// Phase 5에서 portfolio_settings DB 테이블로 영속화 예정
const portfolioSettingsSchema = z.object({
  criticalThreshold: z.number().int().min(50).max(100),
  warningThreshold: z.number().int().min(30).max(99),
  defaultFeedbackStyle: z.enum(['direct', 'socratic']),
  compareScope: z.enum(['current_cohort', 'all']),
});

// GET /admin/portfolio-settings — 현재 설정 조회
router.get('/portfolio-settings', requireRole('admin'), (req, res) => {
  const institutionId = (req as { user?: { institutionId?: string } }).user?.institutionId ?? 'default';
  res.status(200).json(getPortfolioSettings(institutionId));
});

// PUT /admin/portfolio-settings — 설정 저장 (즉시 반영)
router.put('/portfolio-settings', requireRole('admin'), (req, res) => {
  const parsed = portfolioSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (parsed.data.warningThreshold >= parsed.data.criticalThreshold) {
    res.status(400).json({ error: '주의 임계값은 위험 임계값보다 낮아야 합니다.' });
    return;
  }
  const institutionId = (req as { user?: { institutionId?: string } }).user?.institutionId ?? 'default';
  setPortfolioSettings(institutionId, parsed.data);
  res.status(200).json(parsed.data);
});

export default router;
