import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { ingestDocument, type EmbeddingProvider } from '@openmento/rag';
import { getRagIngestQueue } from '../queues/rag-ingest.queue.js';
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
  adminUsers,
  routines,
  routineTriggers,
  costEvents,
  budgetPolicies,
  modelPricing,
  attendanceLogs,
  instructorSkills,
  studentSkills,
  studentCourses,
  agents,
  assignments,
  assignmentComments,
  eq,
  and,
  isNull,
  sql,
  desc,
  gte,
  lte,
  count,
  courses,
  assignmentSubmissions,
  inArray,
  isNotNull,
} from '@openmento/db';
import { invalidateSkillCache, importSkillFromGitHub } from '../services/skill-injector.js';
import { hasCyclicParent } from '../services/agent-hierarchy.js';
import { ConnectorRegistry } from '../mcp/registry.js';
import { withAuditLog, logAgentChange } from '../mcp/audit.js';
import { invalidatePricingCache } from '../services/budget-guard.js';
import { getEwsThresholds, setEwsThresholds } from '../services/ews-thresholds.js';
import { getPortfolioSettings, setPortfolioSettings } from '../services/portfolio-settings-store.js';
import { getInstitutionSetting, setInstitutionSetting } from '../services/institution-settings-service.js';
import {
  triggerAgentManually,
  getHeartbeatStatus,
  cancelHeartbeatRun,
  applyHeartbeatCallback,
  getAgentSession,
  clearAgentSession,
} from '../services/heartbeat.js';
import { verifyAgentToken } from '../services/agent-auth-jwt.js';
import { runHeartbeatProactiveScan, sendHeartbeatMessage } from '../services/heartbeat-proactive.js';
import { sendSlackTestMessage } from '../services/slack-notifier.js';
import { slackTestLimiter } from '../middleware/rateLimiter.js';
import systemRouter from './system.js';
import securityRouter from './security.js';

const router: ReturnType<typeof Router> = Router();

// ─── 보안 키 저장소 (DB Write-Through 캐시) ────────────────────────────────────
// institution-settings-service를 통해 institution_settings 테이블에 영속화
// process.env 업데이트를 통해 LLM 어댑터가 즉시 새 키를 사용할 수 있도록 함
// ⚠️ Phase 5-5: settingValue(secrets) 컬럼 레벨 pgcrypto 암호화 예정
const SECRETS_KEY = 'secrets';
interface AdminSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openclawApiKey?: string;
  geminiApiKey?: string;
  ragOpenaiApiKey?: string;
  ragCohereApiKey?: string;
  ragGoogleApiKey?: string;
  ragEmbeddingDefaultProvider?: EmbeddingProvider;
  slackWebhookUrl?: string;
}
async function getSecrets(institutionId: string): Promise<AdminSecrets> {
  return getInstitutionSetting<AdminSecrets>(institutionId, SECRETS_KEY, {});
}
async function setSecrets(institutionId: string, secrets: AdminSecrets): Promise<void> {
  return setInstitutionSetting<AdminSecrets>(institutionId, SECRETS_KEY, secrets);
}

function interpolateSecretRefs(value: string, secrets: AdminSecrets): string {
  return value.replace(/\$\{\s*secrets\.([a-zA-Z0-9_]+)\s*\}/g, (_, key: string) => {
    const resolved = secrets[key as keyof AdminSecrets];
    return typeof resolved === 'string' ? resolved : '';
  });
}

const RAG_EMBEDDING_PROVIDERS = ['openai', 'cohere', 'google'] as const;

function resolveRagEmbeddingApiKey(
  secrets: AdminSecrets,
  provider: EmbeddingProvider,
): string | undefined {
  switch (provider) {
    case 'openai':
      return secrets.ragOpenaiApiKey ?? secrets.openaiApiKey ?? process.env.OPENAI_API_KEY;
    case 'cohere':
      return secrets.ragCohereApiKey ?? process.env.COHERE_API_KEY;
    case 'google':
      return (
        secrets.ragGoogleApiKey
        ?? secrets.geminiApiKey
        ?? process.env.GOOGLE_API_KEY
        ?? process.env.GEMINI_API_KEY
      );
    default:
      return undefined;
  }
}

function buildAvailableRagProviders(secrets: AdminSecrets): EmbeddingProvider[] {
  return RAG_EMBEDDING_PROVIDERS.filter((provider) =>
    Boolean(resolveRagEmbeddingApiKey(secrets, provider)),
  );
}

// ── Heartbeat 콜백 (외부 webhook 어댑터 전용) ──────────────────────────────────
// 주의: 이 라우트는 admin role이 아닌 agent heartbeat 토큰으로 접근 가능해야 하므로
// requireRole('admin') 적용 전에 배치합니다.
const heartbeatCallbackParamSchema = z.object({ runId: z.string().uuid() });
const heartbeatCallbackBodySchema = z.object({
  success: z.boolean().optional(),
  status: z.enum(['completed', 'failed']).optional(),
  resultJson: z.record(z.unknown()).optional(),
  usageJson: z.record(z.unknown()).optional(),
  stdoutExcerpt: z.string().optional(),
  errorMessage: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).optional(),
  // paperclip Session Codec 호환: 세션 컨텍스트 저장/복원 필드
  sessionParams: z.record(z.unknown()).nullable().optional(),
  sessionId: z.string().nullable().optional(),
  clearSession: z.boolean().optional(),
});

router.post('/heartbeat/runs/:runId/callback', async (req, res) => {
  const parsedParams = heartbeatCallbackParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: '유효하지 않은 runId 형식입니다.' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization 헤더가 필요합니다.' });
    return;
  }

  const token = authHeader.slice(7);

  let institutionId: string;
  let tokenRunId: string;
  try {
    const decoded = verifyAgentToken(token);
    institutionId = decoded.institutionId;
    tokenRunId = decoded.runId;
  } catch {
    res.status(401).json({ error: '유효하지 않은 agent heartbeat 토큰입니다.' });
    return;
  }

  if (tokenRunId !== parsedParams.data.runId) {
    res.status(403).json({ error: '토큰 runId와 요청 runId가 일치하지 않습니다.' });
    return;
  }

  const parsedBody = heartbeatCallbackBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.flatten() });
    return;
  }

  const outcome = await applyHeartbeatCallback(
    parsedParams.data.runId,
    institutionId,
    parsedBody.data,
  );

  if (outcome === 'not_found') {
    res.status(404).json({ error: 'run을 찾을 수 없습니다.' });
    return;
  }

  if (outcome === 'already_finished') {
    res.status(409).json({ error: '이미 종료된 run 입니다.' });
    return;
  }

  res.json({ message: 'callback이 반영되었습니다.', runId: parsedParams.data.runId });
});

// 모든 /admin/* 라우트에 인증 + admin/teacher 역할 검증 적용
router.use(authenticate);
router.use(requireRole('admin', 'teacher'));

// multer: 공유 볼륨 또는 OS tmpdir 디스크 스토리지
// - UPLOAD_TMP_DIR env: Docker 공유 볼륨 경로(rag-worker와 공유)
// - 미설정 시: os.tmpdir() — 로컬 개발 / REDIS_URL 없는 환경
// worker_threads 기반 ingestDocument()가 파일 경로를 요구함 (memoryStorage() 사용 불가)
const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR ?? os.tmpdir();
mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname);
      cb(null, `openmento-upload-${randomUUID()}${ext}`);
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

const singleDocumentUpload = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: '파일 용량이 50MB를 초과합니다.' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    const message = err instanceof Error ? err.message : '파일 업로드 중 오류가 발생했습니다.';
    res.status(400).json({ error: message });
  });
};

// institutionId는 JWT에서 추출 (DocumentManager UI가 전송하지 않음)
const documentUploadSchema = z.object({
  category: z.string().optional(),
  courseId: z.string().uuid().optional(),
  tags: z.preprocess((arg) => {
    if (typeof arg !== 'string') return arg;
    try {
      return JSON.parse(arg);
    } catch {
      return undefined;
    }
  }, z.array(z.string()).optional()),
  enableRag: z.preprocess((arg) => {
    if (typeof arg === 'boolean') return arg;
    if (typeof arg === 'string') return arg.toLowerCase() === 'true';
    return undefined;
  }, z.boolean().optional()),
  embeddingProvider: z.enum(RAG_EMBEDDING_PROVIDERS).optional(),
});


// ============================================
// 강사/관리자 담당 과목 (Course Dashboard)
// ============================================
const courseSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  instructorId: z.string().uuid().optional(),
});

const courseUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

router.get('/courses', async (req, res) => {
  const { institutionId, role, sub: id } = req.user!;
  
  // 강사일 경우 자신이 담당(instructorId)인 것만, 혹은 기관 전체 조회
  const conditions = [
    eq(courses.institutionId, institutionId),
    isNull(courses.deletedAt),
  ];
  if (role === 'teacher') {
    conditions.push(eq(courses.instructorId, id));
  }
  
  const list = await db
    .select()
    .from(courses)
    .where(and(...conditions))
    .orderBy(desc(courses.createdAt));
    
  res.json({ courses: list });
});

router.post('/courses', async (req, res, next) => {
  try {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    
    const { institutionId, role, sub: id } = req.user!;
    const [created] = await db.insert(courses).values({
      institutionId,
      name: parsed.data.name,
      subject: parsed.data.subject,
      instructorId: role === 'teacher' ? id : (parsed.data.instructorId || null),
    }).returning();
    res.status(201).json({ course: created });
  } catch (error) {
    console.error('[Course Create Error]', error);
    next(error);
  }
});

// PUT /admin/courses/:courseId — 과목 수정 (이름, 분야, 활성 여부)
router.put('/courses/:courseId', async (req, res) => {
  const { institutionId, role, sub: userId } = req.user!;
  const { courseId } = req.params;
  const parsed = courseUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청값이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const conditions = [
    eq(courses.id, courseId),
    eq(courses.institutionId, institutionId),
    isNull(courses.deletedAt),
  ];
  if (role === 'teacher') conditions.push(eq(courses.instructorId, userId));

  const [existing] = await db.select({ id: courses.id }).from(courses).where(and(...conditions)).limit(1);
  if (!existing) { res.status(404).json({ error: '과목을 찾을 수 없습니다.' }); return; }

  const [updated] = await db
    .update(courses)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(courses.id, courseId))
    .returning();

  res.json({ course: updated });
});

// DELETE /admin/courses/:courseId — 과목 소프트 삭제
router.delete('/courses/:courseId', async (req, res) => {
  const { institutionId, role, sub: userId } = req.user!;
  const { courseId } = req.params;

  const conditions = [
    eq(courses.id, courseId),
    eq(courses.institutionId, institutionId),
    isNull(courses.deletedAt),
  ];
  if (role === 'teacher') conditions.push(eq(courses.instructorId, userId));

  const [existing] = await db.select({ id: courses.id }).from(courses).where(and(...conditions)).limit(1);
  if (!existing) { res.status(404).json({ error: '과목을 찾을 수 없습니다.' }); return; }

  await db.update(courses).set({ deletedAt: new Date() }).where(eq(courses.id, courseId));
  res.status(204).end();
});

// ── 과목(Course) 하위 현황 API ─────────────────────────────────────────────

// GET /admin/courses/:courseId/summary — 과목 상세 현황 요약
router.get('/courses/:courseId/summary', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;

  // 과목 소유권 확인
  const [course] = await db.select().from(courses).where(
    and(eq(courses.id, courseId), eq(courses.institutionId, institutionId), isNull(courses.deletedAt))
  );
  if (!course) return res.status(404).json({ error: '과목을 찾을 수 없습니다.' });

  const [skillsCount] = await db.select({ cnt: count() }).from(instructorSkills).where(
    and(eq(instructorSkills.courseId, courseId), isNull(instructorSkills.deletedAt))
  );
  const [docsCount] = await db.select({ cnt: sql<number>`COUNT(DISTINCT ${ragDocuments.sourceFileName})` }).from(ragDocuments).where(
    and(eq(ragDocuments.courseId, courseId), isNull(ragDocuments.deletedAt))
  );
  const [studentsCount] = await db.select({ cnt: count() }).from(studentCourses).where(
    and(eq(studentCourses.courseId, courseId), isNull(studentCourses.deletedAt))
  );
  const [assignmentsCount] = await db.select({ cnt: count() }).from(assignments).where(
    and(eq(assignments.courseId, courseId), isNull(assignments.deletedAt))
  );

  res.json({
    course,
    stats: {
      skills: Number(skillsCount?.cnt ?? 0),
      documents: Number(docsCount?.cnt ?? 0),
      students: Number(studentsCount?.cnt ?? 0),
      assignments: Number(assignmentsCount?.cnt ?? 0),
    },
  });
});

// GET /admin/courses/:courseId/students — 과목 수강생 목록 (M2M)
router.get('/courses/:courseId/students', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;
  const list = await db.select({
    id: students.id,
    email: students.email,
    displayName: students.displayName,
    enrolledAt: studentCourses.enrolledAt,
  }).from(studentCourses)
    .innerJoin(students, eq(studentCourses.studentId, students.id))
    .where(
      and(
        eq(studentCourses.courseId, courseId),
        eq(students.institutionId, institutionId),
        isNull(studentCourses.deletedAt),
        isNull(students.deletedAt),
      )
    ).orderBy(desc(studentCourses.enrolledAt));
  res.json({ students: list });
});

// GET /admin/courses/:courseId/skills — 과목에 연결된 스킬 목록
router.get('/courses/:courseId/skills', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;
  const list = await db.select({
    id: instructorSkills.id,
    title: instructorSkills.title,
    tags: instructorSkills.tags,
    createdAt: instructorSkills.createdAt,
  }).from(instructorSkills).where(
    and(eq(instructorSkills.courseId, courseId), eq(instructorSkills.institutionId, institutionId), isNull(instructorSkills.deletedAt))
  ).orderBy(desc(instructorSkills.createdAt));
  res.json({ skills: list });
});

// GET /admin/courses/:courseId/documents — 과목 교재 목록
router.get('/courses/:courseId/documents', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;
  const list = await db.select({
    id: sql<string>`MIN(${ragDocuments.id}::text)`,
    filename: ragDocuments.sourceFileName,
    category: sql<string>`MAX(${ragDocuments.category})`,
    tags: sql<string>`MAX(${ragDocuments.tags}::text)`,
    createdAt: sql<string>`MIN(${ragDocuments.createdAt})`,
  }).from(ragDocuments).where(
    and(eq(ragDocuments.courseId, courseId), eq(ragDocuments.institutionId, institutionId), isNull(ragDocuments.deletedAt))
  ).groupBy(ragDocuments.sourceFileName);
  res.json({ documents: list });
});

// GET /admin/courses/:courseId/assignments — 과목 과제 목록 (제목 단위 집계)
router.get('/courses/:courseId/assignments', async (req, res) => {
  const { courseId } = req.params;
  const list = await db.select({
    assignmentTitle: assignmentSubmissions.assignmentTitle,
    total: count(),
    dueAt: sql<string>`MAX(${assignmentSubmissions.dueAt})`,
  }).from(assignmentSubmissions).where(
    and(eq(assignmentSubmissions.courseId, courseId), isNull(assignmentSubmissions.deletedAt))
  ).groupBy(assignmentSubmissions.assignmentTitle);
  res.json({ assignments: list });
});

// POST /admin/courses/:courseId/assignments — 새 과제 등록 (전체 수강생에게)
router.post('/courses/:courseId/assignments', async (req, res) => {
  const { courseId } = req.params;
  const { title, dueAt } = req.body as { title?: string; dueAt?: string };
  if (!title) return res.status(400).json({ error: 'title 필수입니다.' });

  // 해당 과목 수강생 목록 조회 (M2M)
  const courseStudents = await db.select({ id: students.id })
    .from(studentCourses)
    .innerJoin(students, eq(studentCourses.studentId, students.id))
    .where(and(eq(studentCourses.courseId, courseId), isNull(studentCourses.deletedAt), isNull(students.deletedAt)));
  if (courseStudents.length === 0) return res.status(400).json({ error: '해당 과목에 수강생이 없습니다.' });

  const rows = courseStudents.map(s => ({
    studentId: s.id,
    courseId,
    assignmentTitle: title,
    status: 'missing' as const,
    dueAt: dueAt ? new Date(dueAt) : null,
  }));
  await db.insert(assignmentSubmissions).values(rows);
  res.status(201).json({ created: rows.length });
});

// POST /admin/courses/:courseId/skills/link — 기존 스킬을 과목에 연결
router.post('/courses/:courseId/skills/link', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;
  const { skillId } = req.body as { skillId?: string };
  if (!skillId) { res.status(400).json({ error: 'skillId 필수' }); return; }

  const [skill] = await db.select({ id: instructorSkills.id })
    .from(instructorSkills)
    .where(and(eq(instructorSkills.id, skillId), eq(instructorSkills.institutionId, institutionId), isNull(instructorSkills.deletedAt)))
    .limit(1);
  if (!skill) { res.status(404).json({ error: '스킬을 찾을 수 없습니다.' }); return; }

  await db.update(instructorSkills).set({ courseId, updatedAt: new Date() }).where(eq(instructorSkills.id, skillId));
  res.json({ success: true });
});

// POST /admin/courses/:courseId/documents/link — 기존 교재를 과목에 연결 (파일명 기준 일괄)
router.post('/courses/:courseId/documents/link', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;
  const { sourceFileName } = req.body as { sourceFileName?: string };
  if (!sourceFileName) { res.status(400).json({ error: 'sourceFileName 필수' }); return; }

  await db.update(ragDocuments).set({ courseId })
    .where(and(eq(ragDocuments.sourceFileName, sourceFileName), eq(ragDocuments.institutionId, institutionId)));
  res.json({ success: true });
});

// POST /admin/courses/:courseId/students/link — 수강생을 과목에 배정 (M2M upsert)
router.post('/courses/:courseId/students/link', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId } = req.params;
  const { studentId } = req.body as { studentId?: string };
  if (!studentId) { res.status(400).json({ error: 'studentId 필수' }); return; }

  const [student] = await db.select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.institutionId, institutionId), isNull(students.deletedAt)))
    .limit(1);
  if (!student) { res.status(404).json({ error: '수강생을 찾을 수 없습니다.' }); return; }

  // M2M upsert — 이미 연결돼 있으면 deletedAt 초기화(복구)
  await db.insert(studentCourses)
    .values({ studentId, courseId })
    .onConflictDoUpdate({
      target: [studentCourses.studentId, studentCourses.courseId],
      set: { deletedAt: null, isActive: true },
    });
  res.json({ success: true });
});

// DELETE /admin/courses/:courseId/students/:studentId/unlink — 수강생을 과목에서 제거
router.delete('/courses/:courseId/students/:studentId/unlink', async (req, res) => {
  const { institutionId } = req.user!;
  const { courseId, studentId } = req.params;

  const [student] = await db.select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.institutionId, institutionId), isNull(students.deletedAt)))
    .limit(1);
  if (!student) { res.status(404).json({ error: '수강생을 찾을 수 없습니다.' }); return; }

  await db.update(studentCourses)
    .set({ deletedAt: new Date(), isActive: false })
    .where(and(eq(studentCourses.studentId, studentId), eq(studentCourses.courseId, courseId), isNull(studentCourses.deletedAt)));
  res.json({ success: true });
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
      category: sql<string>`MAX(${ragDocuments.category})`,
      tags: sql<string>`MAX(${ragDocuments.tags}::text)`,
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
      category: d.category,
      tags: d.tags ? JSON.parse(d.tags) : [],
      createdAt: d.createdAt
        ? new Date(d.createdAt).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
    })),
  );
});

// GET /admin/rag/providers — 키 저장소 기준 사용 가능한 RAG 임베딩 프로바이더 조회
router.get('/rag/providers', async (req, res) => {
  const institutionId = req.user?.institutionId ?? 'default';
  const secrets = await getSecrets(institutionId);
  const availableProviders = buildAvailableRagProviders(secrets);
  const fallbackProvider: EmbeddingProvider = 'openai';
  const requestedDefault = secrets.ragEmbeddingDefaultProvider;
  const defaultProvider =
    requestedDefault && availableProviders.includes(requestedDefault)
      ? requestedDefault
      : (availableProviders[0] ?? fallbackProvider);

  res.json({
    defaultProvider,
    providers: RAG_EMBEDDING_PROVIDERS.map((provider) => ({
      id: provider,
      available: availableProviders.includes(provider),
    })),
  });
});

// POST /admin/documents — 교재 업로드 및 RAG 임베딩 등록
// Content-Type: multipart/form-data, Body: file + courseId?(UUID)
//
// ── Phase 5-A 비동기 분리 전략 ──────────────────────────────────────────────
//   REDIS_URL 있음 → BullMQ 큐에 Job 추가 → 202 Accepted (즉시 응답)
//                    rag-worker 프로세스가 백그라운드에서 파싱+임베딩+DB 저장 수행
//   REDIS_URL 없음 → 기존 직접 ingestDocument() 호출 → 201 Created (처리 완료 후 응답)

router.post('/documents', singleDocumentUpload, async (req, res) => {
  const { institutionId } = req.user!;

  if (!req.file) {
    res.status(400).json({ error: '파일이 첨부되지 않았습니다.' });
    return;
  }

  try {
    const parsed = documentUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: '교재 업로드 요청 형식이 올바르지 않습니다.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const courseId = parsed.data.courseId;
    const category = parsed.data.category;
    const tags = parsed.data.tags ?? [];
    const enableRag = parsed.data.enableRag ?? true;
    const requestedProvider = parsed.data.embeddingProvider;
    const secrets = await getSecrets(institutionId);

    let embeddingProvider: EmbeddingProvider | undefined;
    let embeddingApiKey: string | undefined;

    if (enableRag) {
      const configuredDefault = secrets.ragEmbeddingDefaultProvider;
      embeddingProvider = requestedProvider ?? configuredDefault ?? 'openai';
      embeddingApiKey = resolveRagEmbeddingApiKey(secrets, embeddingProvider);

      if (!embeddingApiKey) {
        res.status(400).json({
          error: `선택한 RAG 임베딩 프로바이더(${embeddingProvider})의 API 키가 설정되지 않았습니다. 시스템 외부 연동 Key 저장소에서 RAG 전용 키를 먼저 등록해 주세요.`,
        });
        return;
      }
    }

    const finalTags = Array.from(new Set(
      enableRag && embeddingProvider
        ? [...tags, `rag_provider:${embeddingProvider}`]
        : tags,
    ));

    const deliveryId = randomUUID();

    const ragQueue = getRagIngestQueue();

    if (ragQueue) {
      // ── BullMQ 비동기 경로 (REDIS_URL 있을 때) ────────────────────────────
      // rag-worker 컨테이너가 동일한 공유 볼륨(UPLOAD_TMP_DIR)을 마운트하고 있어야 합니다.
      await ragQueue.add(
        'ingest',
        {
          institutionId,
          courseId,
          category,
          tags: finalTags,
          enableRag,
          embeddingProvider,
          embeddingApiKey,
          fileName: req.file.originalname,
          filePath: req.file.path, // 공유 볼륨 경로
          deliveryId,
        },
        { jobId: deliveryId },
      );
      res.status(202).json({
        status: 'queued',
        jobId: deliveryId,
        filename: req.file.originalname,
        message: enableRag
          ? '임베딩 처리가 백그라운드에서 진행됩니다. 완료 후 문서 목록에 표시됩니다.'
          : '문서 처리가 백그라운드에서 진행됩니다. 완료 후 문서 목록에 표시됩니다.',
      });
      return;
    }

    // ── 직접 호출 fallback (REDIS_URL 없을 때) ────────────────────────────
    await ingestDocument({
      institutionId,
      courseId,
      category,
      tags: finalTags,
      enableRag,
      embeddingProvider,
      embeddingApiKey,
      fileName: req.file.originalname,
      filePath: req.file.path,
    });
    res.status(201).json({
      id: deliveryId,
      filename: req.file.originalname,
      createdAt: new Date().toISOString().split('T')[0],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '문서 업로드 중 오류가 발생했습니다.';
    console.error('문서 업로드 실패', err);
    res.status(500).json({ error: message });
  }
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
router.get('/secrets', async (req, res) => {
  const institutionId = req.user?.institutionId ?? 'default';
  const secrets = await getSecrets(institutionId);
  const mask = (v: string | undefined) =>
    v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '';

  res.json({
    openaiApiKey: mask(secrets.openaiApiKey),
    anthropicApiKey: mask(secrets.anthropicApiKey),
    openclawApiKey: mask(secrets.openclawApiKey),
    geminiApiKey: mask(secrets.geminiApiKey),
    ragOpenaiApiKey: mask(secrets.ragOpenaiApiKey),
    ragCohereApiKey: mask(secrets.ragCohereApiKey),
    ragGoogleApiKey: mask(secrets.ragGoogleApiKey),
    ragEmbeddingDefaultProvider: secrets.ragEmbeddingDefaultProvider ?? 'openai',
    slackWebhookUrl: secrets.slackWebhookUrl ?? '',
  });
});

// PUT /admin/secrets — 보안 키 저장 (DB Write-Through + process.env 즉시 반영)

/** 마스킹 문자(•)가 포함된 문자열을 거부하는 Zod 검증 (안전장치)
 *  GET /admin/secrets 의 마스킹값이 그대로 저장되는 버그를 서버 레이어에서 차단 */
const noMaskChar = (fieldName: string) =>
  z.string().refine((v) => !v.includes('\u2022'), {
    message: `${fieldName}: 마스킹된 값(•)은 저장할 수 없습니다. 실제 키를 입력하세요.`,
  });

const secretsSchema = z.object({
  openaiApiKey: noMaskChar('openaiApiKey').optional(),
  anthropicApiKey: noMaskChar('anthropicApiKey').optional(),
  openclawApiKey: noMaskChar('openclawApiKey').optional(),
  geminiApiKey: noMaskChar('geminiApiKey').optional(),
  ragOpenaiApiKey: noMaskChar('ragOpenaiApiKey').optional(),
  ragCohereApiKey: noMaskChar('ragCohereApiKey').optional(),
  ragGoogleApiKey: noMaskChar('ragGoogleApiKey').optional(),
  ragEmbeddingDefaultProvider: z.enum(RAG_EMBEDDING_PROVIDERS).optional(),
  slackWebhookUrl: z.union([z.string().url(), z.literal('')]).optional(),
});

router.put('/secrets', async (req, res) => {
  const parsed = secretsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const institutionId = req.user?.institutionId ?? 'default';
  const {
    openaiApiKey,
    anthropicApiKey,
    openclawApiKey,
    geminiApiKey,
    ragOpenaiApiKey,
    ragCohereApiKey,
    ragGoogleApiKey,
    ragEmbeddingDefaultProvider,
    slackWebhookUrl,
  } = parsed.data;

  const existing = await getSecrets(institutionId);
  const updated: AdminSecrets = { ...existing };

  if (openaiApiKey) {
    updated.openaiApiKey = openaiApiKey;
    process.env.OPENAI_API_KEY = openaiApiKey;
  }
  if (anthropicApiKey) {
    updated.anthropicApiKey = anthropicApiKey;
    process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  }
  if (openclawApiKey) {
    updated.openclawApiKey = openclawApiKey;
    process.env.OPENCLAW_API_KEY = openclawApiKey;
  }
  if (geminiApiKey) {
    updated.geminiApiKey = geminiApiKey;
    process.env.GEMINI_API_KEY = geminiApiKey;
    process.env.GOOGLE_API_KEY = geminiApiKey;       // Paperclip gemini-local 호환
    process.env.GOOGLE_AI_API_KEY = geminiApiKey;    // Google SDK (GoogleGenerativeAI) 호환
  }
  if (ragOpenaiApiKey) {
    updated.ragOpenaiApiKey = ragOpenaiApiKey;
    process.env.RAG_OPENAI_API_KEY = ragOpenaiApiKey;
  }
  if (ragCohereApiKey) {
    updated.ragCohereApiKey = ragCohereApiKey;
    process.env.RAG_COHERE_API_KEY = ragCohereApiKey;
  }
  if (ragGoogleApiKey) {
    updated.ragGoogleApiKey = ragGoogleApiKey;
    process.env.RAG_GOOGLE_API_KEY = ragGoogleApiKey;
  }
  if (ragEmbeddingDefaultProvider) {
    updated.ragEmbeddingDefaultProvider = ragEmbeddingDefaultProvider;
  }
  if (slackWebhookUrl !== undefined) {
    updated.slackWebhookUrl = slackWebhookUrl;
    process.env.SLACK_WEBHOOK_URL = slackWebhookUrl;
  }

  await setSecrets(institutionId, updated);
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

// POST /admin/heartbeat/runs/:runId/cancel — 실행 중인 run 취소 (paperclip cancelRun 참조)
const cancelRunSchema = z.object({ runId: z.string().uuid() });

router.post('/heartbeat/runs/:runId/cancel', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = cancelRunSchema.safeParse(req.params);

  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 runId 형식입니다.' });
    return;
  }

  const outcome = await cancelHeartbeatRun(parsed.data.runId, institutionId);

  if (outcome === 'not_found') {
    res.status(404).json({ error: 'run을 찾을 수 없습니다.' });
    return;
  }
  if (outcome === 'not_running') {
    res.status(409).json({ error: '실행 중인 run이 아닙니다.' });
    return;
  }

  res.json({ message: 'run 취소 요청이 처리되었습니다.', runId: parsed.data.runId });
});

// POST /admin/heartbeat/proactive/test — 프로액티브 heartbeat 강제 즉시 실행 (30분 활동 체크 무시)
router.post('/heartbeat/proactive/test', async (req, res) => {
  const { institutionId } = req.user!;
  void runHeartbeatProactiveScan({ force: true, institutionId }).catch(() => undefined);
  res.json({ ok: true, message: '프로액티브 heartbeat 스캔이 시작되었습니다.' });
});

// POST /admin/heartbeat/proactive/send — 특정 에이전트/수강생에게 직접 heartbeat 전송 (테스트용)
const directSendSchema = z.object({
  agentId: z.string().uuid(),
  studentId: z.string().uuid(),
  courseId: z.string().uuid(),
});
router.post('/heartbeat/proactive/send', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = directSendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const messageId = await sendHeartbeatMessage({ ...parsed.data, institutionId, turnIndex: 0 });
  if (!messageId) {
    res.status(422).json({ error: '메시지 전송 실패 — 에이전트 설정 또는 API 키를 확인하세요.' });
    return;
  }
  res.json({ ok: true, messageId });
});

// GET /admin/agents/:agentId/session — 에이전트 세션 상태 조회 (Session Codec)
router.get('/agents/:agentId/session', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = z.object({ agentId: z.string().uuid() }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 agentId 형식입니다.' });
    return;
  }

  const session = await getAgentSession(parsed.data.agentId, institutionId);
  if (!session) {
    res.json({ hasSession: false, sessionParams: null, displayId: null });
    return;
  }

  res.json({ hasSession: true, ...session });
});

// DELETE /admin/agents/:agentId/session — 에이전트 세션 초기화 (Session Codec)
router.delete('/agents/:agentId/session', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = z.object({ agentId: z.string().uuid() }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 agentId 형식입니다.' });
    return;
  }

  const outcome = await clearAgentSession(parsed.data.agentId, institutionId);
  if (outcome === 'not_found') {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }

  res.json({ cleared: true, agentId: parsed.data.agentId });
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
  provider: z.enum(['openai', 'anthropic', 'google', 'gemini_cli', 'openclaw']),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  adapterType: z.enum(['llm_api', 'http_webhook']).optional(),
  webhookUrl: z.string().url().optional(),
  webhookHeaders: z.record(z.string()).optional(),
  contextMode: z.enum(['thin', 'fat']).optional(),
  promptTemplate: z.string().max(4000).optional(),
}).superRefine((value, ctx) => {
  if (value.adapterType === 'http_webhook' && !value.webhookUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['webhookUrl'],
      message: 'adapterType이 http_webhook이면 webhookUrl은 필수입니다.',
    });
  }
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  role: z.enum(['orchestrator', 'ews_monitor', 'ai_instructor', 'ai_tutor', 'mental_care', 'portfolio_reviewer']),
  // paperclip: title — 표시용 직함
  title: z.string().max(120).optional().nullable(),
  // paperclip: icon — UI 아이콘 식별자
  icon: z.string().max(60).optional().nullable(),
  // paperclip: capabilities — 자연어 능력 설명 (위임 탐색용)
  capabilities: z.string().max(800).optional().nullable(),
  reportsTo: z.string().uuid().optional().nullable(),
  adapterConfig: adapterConfigSchema,
  fallbackAdapterConfig: adapterConfigSchema.optional().nullable(),
  // paperclip: runtimeConfig — heartbeat 스케줄 설정
  runtimeConfig: z.object({
    heartbeat: z.object({
      enabled: z.boolean().default(false),
      intervalSec: z.number().int().min(30).max(86400).default(300),
      maxConcurrentRuns: z.number().int().min(1).max(5).default(1),
      proactive: z.boolean().optional(),
      dailyLimit: z.number().int().min(1).max(1000).optional(),
      promptTemplate: z.string().max(2000).optional(),
    }).optional(),
  }).optional().default({}),
  // paperclip: permissions — 자율 실행 권한
  permissions: z.object({
    canHireDirect: z.boolean().default(false),
    canAssignTasks: z.boolean().default(false),
    canAccessSecrets: z.boolean().default(false),
  }).optional().default({}),
  systemPrompt: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  // RAG 활성화 여부 — false면 교재 벡터 검색 없이 LLM만 호출 (기본값: true)
  ragEnabled: z.boolean().default(true),
});

const updateAgentSchema = createAgentSchema.partial();

const adapterTestSchema = z.object({
  adapterConfig: adapterConfigSchema,
});

/**
 * POST /admin/adapters/test
 * adapterConfig 사전 검증 (paperclip testEnvironment 참조)
 */
router.post('/adapters/test', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = adapterTestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const adapterConfig = parsed.data.adapterConfig;

  // HTTP webhook 어댑터는 실제 연결성까지 점검
  if (adapterConfig.adapterType === 'http_webhook') {
    if (!adapterConfig.webhookUrl) {
      res.status(400).json({ error: 'webhookUrl이 필요합니다.' });
      return;
    }

    const secrets = await getSecrets(institutionId);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(adapterConfig.webhookHeaders ?? {})) {
      headers[k] = interpolateSecretRefs(v, secrets);
    }

    const timeoutMs = Math.min(adapterConfig.timeoutMs ?? 5000, 15000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(adapterConfig.webhookUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          type: 'openmento_adapter_test',
          timestamp: new Date().toISOString(),
        }),
      });

      res.json({
        ok: response.status < 500,
        adapterType: 'http_webhook',
        status: response.status,
        statusText: response.statusText,
        message: response.status < 500
          ? 'Webhook endpoint 연결이 확인되었습니다.'
          : 'Webhook endpoint 연결은 되었지만 서버 오류(5xx)를 반환했습니다.',
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      res.status(502).json({
        ok: false,
        adapterType: 'http_webhook',
        error: timedOut
          ? `Webhook endpoint 타임아웃 (${timeoutMs}ms)`
          : (err instanceof Error ? err.message : String(err)),
      });
    } finally {
      clearTimeout(timeout);
    }

    return;
  }

  // LLM API 어댑터는 기관 secrets 존재 여부를 사전 검증
  const secrets = await getSecrets(institutionId);
  const missingKeyByProvider: Partial<Record<string, string>> = {
    openai: 'openaiApiKey',
    anthropic: 'anthropicApiKey',
    openclaw: 'openclawApiKey',
    google: 'geminiApiKey',
    gemini_cli: 'geminiApiKey',
  };

  const requiredSecretKey = missingKeyByProvider[adapterConfig.provider];
  if (requiredSecretKey && !secrets[requiredSecretKey as keyof AdminSecrets]) {
    res.status(422).json({
      ok: false,
      adapterType: adapterConfig.adapterType ?? 'llm_api',
      error: `${adapterConfig.provider} provider 사용을 위해 secrets.${requiredSecretKey}가 필요합니다.`,
    });
    return;
  }

  res.json({
    ok: true,
    adapterType: adapterConfig.adapterType ?? 'llm_api',
    message: '어댑터 설정이 유효합니다.',
  });
});

// ── 조직도 API ──────────────────────────────────────────────────────────────

/**
 * GET /admin/org
 * 기관 전체 에이전트를 reportsTo 기반의 재귀 트리로 반환
 * query ?instructorId=xxx 로 특정 강사 조직도만 필터링 가능
 *
 * OrgNode: { id, name, role, status, instructorId, instructorName?, reports: OrgNode[] }
 */
router.get('/org', async (req, res) => {
  const institutionId = req.user?.institutionId;
  if (!institutionId) { res.status(400).json({ error: 'institutionId 없음' }); return; }

  const filterInstructorId = req.query.instructorId as string | undefined;

  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      status: agents.status,
      reportsTo: agents.reportsTo,
      instructorId: agents.instructorId,
      adapterConfig: agents.adapterConfig,
      icon: agents.icon,
      title: agents.title,
    })
    .from(agents)
    .where(and(eq(agents.institutionId, institutionId), isNull(agents.deletedAt)));

  // 강사 이름 조회
  const instructorIds = [...new Set(rows.map(r => r.instructorId).filter(Boolean))] as string[];
  const instructorNameMap = new Map<string, string>();
  if (instructorIds.length > 0) {
    const instructors = await db
      .select({ id: adminUsers.id, name: adminUsers.name })
      .from(adminUsers)
      .where(inArray(adminUsers.id, instructorIds));
    for (const ins of instructors) instructorNameMap.set(ins.id, ins.name);
  }

  // reportsTo 기반 재귀 트리 빌드
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const key = row.reportsTo ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(row);
    byParent.set(key, arr);
  }

  type OrgNode = {
    id: string; name: string; role: string; status: string;
    title: string | null; icon: string | null;
    instructorId: string | null; instructorName: string | null;
    reports: OrgNode[];
  };

  const build = (parentId: string | null): OrgNode[] =>
    (byParent.get(parentId) ?? []).map(r => ({
      id: r.id, name: r.name, role: r.role, status: r.status,
      title: r.title, icon: r.icon,
      instructorId: r.instructorId ?? null,
      instructorName: r.instructorId ? (instructorNameMap.get(r.instructorId) ?? null) : null,
      reports: build(r.id),
    }));

  let roots = build(null);

  // 강사 필터 — 루트 에이전트의 instructorId가 일치하는 것만
  if (filterInstructorId) {
    roots = roots.filter(r => r.instructorId === filterInstructorId);
  }

  res.json({ org: roots });
});

/**
 * GET /admin/org/full
 * 5계층 조직도: 강사 → 과목 → skills → 에이전트 / 수강생
 * query ?instructorId=xxx 로 특정 강사 필터링 가능
 * 미연결 자산(unassigned skills / agents)도 포함
 */
router.get('/org/full', async (req, res) => {
  try {
  const institutionId = req.user?.institutionId;
  if (!institutionId) { res.status(400).json({ error: 'institutionId 없음' }); return; }

  const filterInstructorId = req.query.instructorId as string | undefined;

  // 1) 강사 목록 (role: instructor | teacher)
  const instructorRows = await db
    .select({ id: adminUsers.id, name: adminUsers.name, role: adminUsers.role })
    .from(adminUsers)
    .where(and(
      eq(adminUsers.institutionId, institutionId),
      eq(adminUsers.isActive, true),
      inArray(adminUsers.role, ['instructor', 'teacher']),
      ...(filterInstructorId ? [eq(adminUsers.id, filterInstructorId)] : []),
    ));

  // 2) 과목 목록
  const courseRows = await db
    .select({ id: courses.id, name: courses.name, subject: courses.subject, instructorId: courses.instructorId })
    .from(courses)
    .where(and(eq(courses.institutionId, institutionId), isNull(courses.deletedAt)));

  // 3) 스킬 목록
  const skillRows = await db
    .select({
      id: instructorSkills.id,
      title: instructorSkills.title,
      courseId: instructorSkills.courseId,
      agentId: instructorSkills.agentId,
      isPrivate: sql<boolean>`"instructor_skills"."is_private"`,
      scope: sql<string>`"instructor_skills"."scope"`,
      tags: instructorSkills.tags,
    })
    .from(instructorSkills)
    .where(and(eq(instructorSkills.institutionId, institutionId), isNull(instructorSkills.deletedAt)));

  // 4) 에이전트 목록
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      status: agents.status,
      title: agents.title,
      isPrivate: sql<boolean>`"agents"."is_private"`,
      scope: sql<string>`"agents"."scope"`,
      model: sql<string | null>`"agents"."adapter_config"->>'model'`,
    })
    .from(agents)
    .where(and(eq(agents.institutionId, institutionId), isNull(agents.deletedAt)));

  // 5) 과목별 수강생 목록 (5계층)
  const studentCourseRows = await db
    .select({
      courseId: studentCourses.courseId,
      studentId: students.id,
      displayName: students.displayName,
      email: students.email,
    })
    .from(studentCourses)
    .innerJoin(students, eq(studentCourses.studentId, students.id))
    .where(and(
      eq(students.institutionId, institutionId),
      isNull(studentCourses.deletedAt),
      isNull(students.deletedAt),
    ));

  // courseId → students[] 맵
  const courseStudentsMap = new Map<string, { id: string; displayName: string | null; email: string | null }[]>();
  for (const row of studentCourseRows) {
    if (!row.courseId) continue;
    const arr = courseStudentsMap.get(row.courseId) ?? [];
    arr.push({ id: row.studentId, displayName: row.displayName, email: row.email ?? null });
    courseStudentsMap.set(row.courseId, arr);
  }

  // 에이전트 Map
  const agentMap = new Map(agentRows.map(a => [a.id, a]));
  // 스킬에서 연결된 agentId 집합
  const connectedAgentIds = new Set(skillRows.map(s => s.agentId).filter(Boolean));

  // 5계층 트리 구성
  type OrgAgent = { id: string; name: string; role: string; status: string; title: string | null; isPrivate: boolean; scope: string; model: string | null };
  type OrgSkill = { id: string; title: string; isPrivate: boolean; scope: string; tags: string[] | null; agent: OrgAgent | null };
  type OrgStudent = { id: string; displayName: string | null; email: string | null };
  type OrgCourse = { id: string; name: string; subject: string; skills: OrgSkill[]; students: OrgStudent[] };
  type OrgInstructor = { id: string; name: string; role: string; courses: OrgCourse[] };

  const tree: OrgInstructor[] = instructorRows.map(ins => {
    const insCourses = courseRows.filter(c => c.instructorId === ins.id);
    return {
      id: ins.id,
      name: ins.name,
      role: ins.role,
      courses: insCourses.map(c => {
        const cSkills = skillRows.filter(s => s.courseId === c.id);
        return {
          id: c.id,
          name: c.name,
          subject: c.subject,
          students: courseStudentsMap.get(c.id) ?? [],
          skills: cSkills.map(s => ({
            id: s.id,
            title: s.title,
            isPrivate: s.isPrivate ?? false,
            scope: s.scope ?? 'global',
            tags: s.tags ?? null,
            agent: s.agentId ? (agentMap.get(s.agentId) ? {
              id: agentMap.get(s.agentId)!.id,
              name: agentMap.get(s.agentId)!.name,
              role: agentMap.get(s.agentId)!.role,
              status: agentMap.get(s.agentId)!.status,
              title: agentMap.get(s.agentId)!.title ?? null,
              isPrivate: agentMap.get(s.agentId)!.isPrivate ?? false,
              scope: agentMap.get(s.agentId)!.scope ?? 'global',
              model: agentMap.get(s.agentId)!.model ?? null,
            } : null) : null,
          })),
        };
      }),
    };
  });

  // 미연결 자산 (과목에 연결되지 않은 스킬, 스킬에 연결되지 않은 에이전트)
  const unassignedSkills = skillRows
    .filter(s => !s.courseId)
    .map(s => ({
      id: s.id,
      title: s.title,
      isPrivate: s.isPrivate ?? false,
      scope: s.scope ?? 'global',
      tags: s.tags ?? null,
      agent: s.agentId ? (agentMap.get(s.agentId) ? {
        id: agentMap.get(s.agentId)!.id,
        name: agentMap.get(s.agentId)!.name,
        role: agentMap.get(s.agentId)!.role,
        status: agentMap.get(s.agentId)!.status,
        title: agentMap.get(s.agentId)!.title ?? null,
        isPrivate: agentMap.get(s.agentId)!.isPrivate ?? false,
        scope: agentMap.get(s.agentId)!.scope ?? 'global',
        model: agentMap.get(s.agentId)!.model ?? null,
      } : null) : null,
    }));

  const unassignedAgents = agentRows
    .filter(a => !connectedAgentIds.has(a.id))
    .map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      title: a.title ?? null,
      isPrivate: a.isPrivate ?? false,
      scope: a.scope ?? 'global',
      model: a.model ?? null,
    }));

  res.json({ tree, unassigned: { skills: unassignedSkills, agents: unassignedAgents } });
  } catch (err: any) {
    console.error('[org/full]', err);
    res.status(500).json({ error: '조직도 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * GET /admin/org/instructors
 * 조직도에 연결된 에이전트가 있는 강사 목록 반환 (선택바용)
 */
router.get('/org/instructors', async (req, res) => {
  try {
    const institutionId = req.user?.institutionId;
    if (!institutionId) { res.status(400).json({ error: 'institutionId 없음' }); return; }

    // 과목을 가진 강사/교사 ID 목록
    const courseRows = await db
      .select({ instructorId: courses.instructorId })
      .from(courses)
      .where(and(eq(courses.institutionId, institutionId), isNull(courses.deletedAt)));

    const ids = [...new Set(courseRows.map(r => r.instructorId).filter(Boolean))] as string[];

    if (ids.length === 0) {
      // 과목이 없으면 institution 내 instructor/teacher 전체 반환
      const all = await db
        .select({ id: adminUsers.id, name: adminUsers.name, role: adminUsers.role })
        .from(adminUsers)
        .where(and(
          eq(adminUsers.institutionId, institutionId),
          eq(adminUsers.isActive, true),
          inArray(adminUsers.role, ['instructor', 'teacher']),
        ));
      res.json({ instructors: all }); return;
    }

    const instructors = await db
      .select({ id: adminUsers.id, name: adminUsers.name, role: adminUsers.role })
      .from(adminUsers)
      .where(inArray(adminUsers.id, ids));

    res.json({ instructors });
  } catch (err) {
    console.error('[org/instructors]', err);
    res.status(500).json({ error: '강사 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * PATCH /admin/agents/:id/instructor
 * 에이전트에 담당 강사 할당
 */
router.patch('/agents/:id/instructor', async (req, res) => {
  const institutionId = req.user?.institutionId;
  const { id } = req.params;
  const { instructorId } = req.body as { instructorId: string | null };

  if (instructorId !== null) {
    const [ins] = await db.select({ id: adminUsers.id })
      .from(adminUsers).where(eq(adminUsers.id, instructorId)).limit(1);
    if (!ins) { res.status(404).json({ error: '강사를 찾을 수 없습니다.' }); return; }
  }

  await db.update(agents)
    .set({ instructorId: instructorId ?? null, updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!), isNull(agents.deletedAt)));

  res.json({ ok: true });
});

/**
 * PATCH /admin/agents/:id/reports-to
 * 에이전트 계층 관계 변경 (reportsTo 수정)
 */
router.patch('/agents/:id/reports-to', async (req, res) => {
  const institutionId = req.user?.institutionId;
  const { id } = req.params;
  const { reportsTo } = req.body as { reportsTo: string | null };

  await db.update(agents)
    .set({ reportsTo: reportsTo ?? null, updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!), isNull(agents.deletedAt)));

  res.json({ ok: true });
});

/**
 * GET /admin/agents
 * 기관 소속 전체 에이전트 목록 조회 (소프트 딜리트 제외)
 */
router.get('/agents', async (req, res) => {
  const institutionId = req.user?.institutionId;
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
  const institutionId = req.user?.institutionId;
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
  const institutionId = req.user?.institutionId;
  const actorId = req.user?.sub;
  if (!institutionId) {
    res.status(400).json({ error: 'institutionId가 없습니다.' });
    return;
  }

  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { reportsTo, fallbackAdapterConfig, runtimeConfig, permissions, ...rest } = parsed.data;

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
      runtimeConfig: runtimeConfig ?? {},
      permissions: permissions ?? {},
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
  const institutionId = req.user?.institutionId;
  const actorId = req.user?.sub;
  const { id } = req.params;

  const parsed = updateAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { reportsTo, fallbackAdapterConfig, runtimeConfig, permissions, ...rest } = parsed.data;

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
  if (runtimeConfig !== undefined) updateValues.runtimeConfig = runtimeConfig;
  if (permissions !== undefined) updateValues.permissions = permissions;

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
  const institutionId = req.user?.institutionId;
  const actorId = req.user?.sub;
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

/**
 * POST /admin/agents/:id/pause — 에이전트 일시정지
 * paperclip: status → 'paused'
 */
router.post('/agents/:id/pause', async (req, res) => {
  const institutionId = req.user?.institutionId;
  const { id } = req.params;
  const { reason } = req.body as { reason?: string };

  const [current] = await db
    .select({ status: agents.status })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!), isNull(agents.deletedAt)))
    .limit(1);

  if (!current) {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }
  if (current.status === 'terminated') {
    res.status(409).json({ error: '종료된 에이전트는 상태를 변경할 수 없습니다.' });
    return;
  }

  const [updated] = await db
    .update(agents)
    .set({ status: 'paused', pauseReason: reason ?? null, budgetPausedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!)))
    .returning({ id: agents.id, status: agents.status });

  res.json({ agent: updated });
});

/**
 * POST /admin/agents/:id/resume — 에이전트 재개 (paused → idle)
 * paperclip: status → 'idle'
 */
router.post('/agents/:id/resume', async (req, res) => {
  const institutionId = req.user?.institutionId;
  const { id } = req.params;

  const [current] = await db
    .select({ status: agents.status })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!), isNull(agents.deletedAt)))
    .limit(1);

  if (!current) {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }
  if (current.status === 'terminated') {
    res.status(409).json({ error: '종료된 에이전트는 재개할 수 없습니다.' });
    return;
  }

  const [updated] = await db
    .update(agents)
    .set({ status: 'idle', pauseReason: null, budgetPausedAt: null, updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!)))
    .returning({ id: agents.id, status: agents.status });

  res.json({ agent: updated });
});

/**
 * POST /admin/agents/:id/terminate — 에이전트 영구 종료 (비가역)
 * paperclip: status → 'terminated'
 */
router.post('/agents/:id/terminate', async (req, res) => {
  const institutionId = req.user?.institutionId;
  const { id } = req.params;

  const [current] = await db
    .select({ status: agents.status, name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!), isNull(agents.deletedAt)))
    .limit(1);

  if (!current) {
    res.status(404).json({ error: '에이전트를 찾을 수 없습니다.' });
    return;
  }
  if (current.status === 'terminated') {
    res.status(409).json({ error: '이미 종료된 에이전트입니다.' });
    return;
  }

  const [updated] = await db
    .update(agents)
    .set({ status: 'terminated', isActive: false, updatedAt: new Date() })
    .where(and(eq(agents.id, id), eq(agents.institutionId, institutionId!)))
    .returning({ id: agents.id, status: agents.status });

  res.json({ agent: updated });
});

// ── 스킬 파일 CRUD (Phase 3-1) ───────────────────────────────────────────────

const createSkillSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
  courseId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  isActive: z.boolean().default(true),
    tags: z.array(z.string()).optional(),
});

const updateSkillSchema = z.object({
  title: z.string().min(1).optional(),
  markdown: z.string().min(1).optional(),
  courseId: z.string().uuid().nullable().optional(),
  agentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
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
 * GET /admin/skills/:id
 * 특정 스킬의 상세 정보(마크다운 등을 포함)를 조회합니다.
 */
router.get('/skills/:id', async (req, res) => {
  const { id } = req.params;
  const { institutionId } = req.user!;
  
  const [skill] = await db
    .select()
    .from(instructorSkills)
    .where(
      and(
        eq(instructorSkills.id, id),
        eq(instructorSkills.institutionId, institutionId),
        isNull(instructorSkills.deletedAt)
      )
    )
    .limit(1);

  if (!skill) return res.status(404).json({ error: '스킬을 찾을 수 없습니다.' });
  res.json(skill);
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
    const { title, markdown, courseId, agentId, isActive, tags } = parsed.data;

  const [skill] = await db
    .insert(instructorSkills)
      .values({ institutionId, title, markdown, courseId, agentId, isActive, tags })
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

// ── 포트폴리오 설정 (DB Write-Through 캐시, 기관별) ─────────────────────────
const portfolioSettingsSchema = z.object({
  criticalThreshold: z.number().int().min(50).max(100),
  warningThreshold: z.number().int().min(30).max(99),
  defaultFeedbackStyle: z.enum(['direct', 'socratic']),
  compareScope: z.enum(['current_cohort', 'all']),
});

// GET /admin/portfolio-settings — 현재 설정 조회
router.get('/portfolio-settings', requireRole('admin'), async (req, res) => {
  const institutionId = (req as { user?: { institutionId?: string } }).user?.institutionId ?? 'default';
  const settings = await getPortfolioSettings(institutionId);
  res.status(200).json(settings);
});

// PUT /admin/portfolio-settings — 설정 저장 (DB 즉시 반영)
router.put('/portfolio-settings', requireRole('admin'), async (req, res) => {
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
  await setPortfolioSettings(institutionId, parsed.data);
  res.status(200).json(parsed.data);
});

// ── Phase 5-4: 시스템 상태 모니터링 하위 라우터 ─────────────────────────────
// adminRouter가 이미 authenticate + requireRole('admin') 를 적용하므로
// /admin/system/* 전체가 admin 전용으로 보호됩니다.
router.use('/system', systemRouter);

// ── Phase 5-5: 보안 감사 리포트 하위 라우터 ──────────────────────────────────
// /admin/security/audit-report, /admin/security/rbac-report
// adminRouter의 authenticate + requireRole('admin') 보호를 그대로 상속합니다.
router.use('/security', securityRouter);

// [임시 기능]: 대시보드 테스트용 더미 학생 추가
router.post('/dummy-student', async (req, res) => {
  const { institutionId } = req.user!;
  try {
    const newStudent = await db
      .insert(students)
      .values({
        institutionId,
        displayName: '홍테스트' + Math.floor(Math.random() * 1000),
      })
      .returning();
    res.json({ success: true, student: newStudent[0] });
  } catch (error) {
    console.error('더미 학생 추가 실패:', error);
    res.status(500).json({ error: '학생 추가 중 오류 발생' });
  }
});



// [신규 기능]: 학생 관리 (학생 목록 조회) — 수강 과목 목록 포함
router.get('/students', async (req, res) => {
  const { institutionId } = req.user!;
  try {
    const rows = await db
      .select({
        id: students.id,
        anonymousId: students.anonymousId,
        displayName: students.displayName,
        courseId: students.courseId,
        email: students.email,
        instructorId: students.instructorId,
      })
      .from(students)
      .where(
        and(
          eq(students.institutionId, institutionId),
          isNull(students.deletedAt)
        )
      )
      .orderBy(students.id);

    // 각 수강생의 수강 과목 목록 조회 (M2M)
    const studentIds = rows.map(r => r.id);
    let enrollments: { studentId: string; courseId: string; courseName: string; subject: string }[] = [];
    if (studentIds.length > 0) {
      enrollments = await db
        .select({
          studentId: studentCourses.studentId,
          courseId: courses.id,
          courseName: courses.name,
          subject: courses.subject,
        })
        .from(studentCourses)
        .innerJoin(courses, eq(studentCourses.courseId, courses.id))
        .where(
          and(
            inArray(studentCourses.studentId, studentIds),
            isNull(studentCourses.deletedAt),
            isNull(courses.deletedAt),
          )
        );
    }

    // 수강생별로 과목 목록 그룹핑
    const enrollmentMap = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const arr = enrollmentMap.get(e.studentId) ?? [];
      arr.push(e);
      enrollmentMap.set(e.studentId, arr);
    }

    const result = rows.map(r => ({
      ...r,
      enrolledCourses: enrollmentMap.get(r.id) ?? [],
    }));

    res.json(result);
  } catch (error) {
    console.error('학생 목록 조회 실패', error);
    res.status(500).json({ error: '학생 목록 조회 중 오류 발생' });
  }
});

// [신규 기능]: 학생 추가 (정식 모달 폼 처리용)
router.post('/students', async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = z.object({ displayName: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '잘못된 입력입니다.' });
    return;
  }
  try {
    const newStudent = await db
      .insert(students)
      .values({
        institutionId,
        displayName: parsed.data.displayName,
      })
      .returning({
        id: students.id,
        anonymousId: students.anonymousId,
        displayName: students.displayName
      });
    
    // [신규 기능]: 수강생 직접 회원가입 초대 링크 생성 (Phase 2-2)
    // 보안을 위해 실제 환경에서는 별도 invitation_tokens 테이블을 권장합니다.
    // 현재는 anonymousId를 기반으로 임시 초대 토큰을 생성합니다.
    const inviteUrl = `${req.protocol}://${req.get('host')}/register?token=${newStudent[0].anonymousId}`;
    
    res.status(201).json({
      ...newStudent[0],
      inviteUrl,
    });
  } catch (error) {
    console.error('신규 학생 추가 실패', error);
    res.status(500).json({ error: '신규 학생 추가 중 오류 발생' });
  }
});

// [신규 기능]: 학생 수정 (displayName, tags)
router.put('/students/:id', requireRole('admin', 'teacher'), async (req, res) => {
  const { institutionId } = req.user!;
  const { id } = req.params;
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) {
    res.status(400).json({ error: '잘못된 학생 ID 형식입니다.' });
    return;
  }
  const parsed = z.object({
    displayName: z.string().min(1).max(200).optional(),
    tags:        z.array(z.string()).optional(),
      instructorId: z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: students.id })
          .from(students)
          .where(and(
            eq(students.id, id),
            eq(students.institutionId, institutionId),
            isNull(students.deletedAt),
          ))
          .limit(1);
        if (!target) {
          return null;
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (parsed.data.displayName !== undefined) updateData.displayName = parsed.data.displayName;
        if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
        if (parsed.data.instructorId !== undefined) updateData.instructorId = parsed.data.instructorId;

        const updatedRows = await tx
          .update(students)
          .set(updateData)
          .where(and(
            eq(students.id, id),
            eq(students.institutionId, institutionId),
            isNull(students.deletedAt),
          ))
          .returning();

        // Guardrail: any accidental multi-row update is treated as fatal and rolled back.
        if (updatedRows.length !== 1) {
          throw new Error(`[students:update] 예상 외 수정 건수: ${updatedRows.length}`);
        }

        return updatedRows[0];
      });

      if (!updated) {
        res.status(404).json({ error: '해당 학생을 찾을 수 없습니다.' });
        return;
      }

      res.json(updated);
    } catch (err) {
    console.error('학생 정보 수정 실패', err);
    res.status(500).json({ error: '학생 정보 수정 중 오류 발생' });
  }
});

// [신규 기능]: 학생 삭제 (Soft Delete)
router.delete('/students/:id', async (req, res) => {
  const { institutionId } = req.user!;
  try {
    const deleted = await db
      .update(students)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(students.id, req.params.id),
        eq(students.institutionId, institutionId)
      ))
      .returning({ id: students.id });
    
    if (deleted.length === 0) {
      res.status(404).json({ error: '학생을 찾을 수 없거나 권한이 없습니다.' });
      return;
    }
    
    res.json({ message: '해당 학생이 성공적으로 비활성화(삭제) 되었습니다.' });
  } catch (error) {
    console.error('학생 삭제 실패', error);
    res.status(500).json({ error: '학생 삭제 중 오류 발생' });
  }
});

// ── IAM: 강사 계정 관리 ──────────────────────────────────────────────────────

const instructorCreateSchema = z.object({
  name:     z.string().min(1).max(100),
  email:    z.string().email(),
  password: z.string().min(8).max(128),
  tags:     z.array(z.string()).optional(),
});

const instructorUpdateSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  isActive:    z.boolean().optional(),
  tags:        z.array(z.string()).optional(),
  permissions: z.number().int().min(0).optional(), // 비트마스크 권한 값
  studentIds:  z.array(z.string().uuid()).optional(),
});

/** GET /admin/instructors — 강사 목록 조회 */
router.get('/instructors', async (req, res) => {
  const { institutionId } = req.user!;
  try {
    const rows = await db
      .select({
        id: adminUsers.id,
        name: adminUsers.name,
        email: adminUsers.email,
        role: adminUsers.role,
        permissions: adminUsers.permissions,
        isActive: adminUsers.isActive,
        lastLoginAt: adminUsers.lastLoginAt,
        createdAt: adminUsers.createdAt,
      })
      .from(adminUsers)
      .where(
        and(
          eq(adminUsers.institutionId, institutionId),
          eq(adminUsers.role, 'teacher'),
        )
      )
      .orderBy(desc(adminUsers.createdAt));

    const mappedStudents = await db
      .select({
        id: students.id,
        instructorId: students.instructorId,
        displayName: students.displayName,
      })
      .from(students)
      .where(
        and(
          eq(students.institutionId, institutionId),
          isNotNull(students.instructorId)
        )
      );

    const result = rows.map((instructor) => ({
      ...instructor,
      students: mappedStudents.filter((s) => s.instructorId === instructor.id).map(s => ({ id: s.id, displayName: s.displayName })),
    }));

    // 강사별 담당 과목 조회
    const instructorIds = rows.map(r => r.id);
    type InstructorCourse = { instructorId: string; courseId: string; courseName: string; subject: string };
    let instructorCourses: InstructorCourse[] = [];
    if (instructorIds.length > 0) {
      const rawCourses = await db
        .select({
          instructorId: courses.instructorId,
          courseId: courses.id,
          courseName: courses.name,
          subject: courses.subject,
        })
        .from(courses)
        .where(
          and(
            inArray(courses.instructorId, instructorIds),
            isNull(courses.deletedAt),
          )
        );
      instructorCourses = rawCourses
        .filter((c): c is typeof c & { instructorId: string } => c.instructorId !== null)
        .map(c => ({
          instructorId: c.instructorId,
          courseId: c.courseId,
          courseName: c.courseName,
          subject: c.subject,
        }));
    }
    const courseMap = new Map<string, InstructorCourse[]>();
    for (const c of instructorCourses) {
      const arr = courseMap.get(c.instructorId) ?? [];
      arr.push(c);
      courseMap.set(c.instructorId, arr);
    }

    const finalResult = result.map(r => ({
      ...r,
      assignedCourses: courseMap.get(r.id) ?? [],
    }));

    res.json(finalResult);
  } catch (err) {
    console.error('강사 목록 조회 실패', err);
    res.status(500).json({ error: '강사 목록 조회 중 오류 발생' });
  }
});

/** POST /admin/instructors — 강사 계정 생성 */
router.post('/instructors', requireRole('admin'), async (req, res) => {
  const { institutionId } = req.user!;
  const parsed = instructorCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, email, password, tags } = parsed.data;
  try {
    // 이메일 중복 검사
    const [existing] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: '이미 사용 중인 이메일입니다.' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [created] = await db
      .insert(adminUsers)
      .values({ institutionId, name, email, passwordHash, role: 'teacher', tags: tags || [] })
      .returning({
        id: adminUsers.id,
        name: adminUsers.name,
        email: adminUsers.email,
        role: adminUsers.role,
        isActive: adminUsers.isActive,
        createdAt: adminUsers.createdAt,
      });
    res.status(201).json(created);
  } catch (err) {
    console.error('강사 계정 생성 실패', err);
    res.status(500).json({ error: '강사 계정 생성 중 오류 발생' });
  }
});

/** PUT /admin/instructors/:id — 강사 정보 수정 (이름, 활성/비활성) */
router.put('/instructors/:id', requireRole('admin'), async (req, res) => {
  const { institutionId } = req.user!;
  const { id } = req.params;
  const parsed = instructorUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const [target] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(eq(adminUsers.id, id), eq(adminUsers.institutionId, institutionId), eq(adminUsers.role, 'teacher')))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: '해당 강사 계정을 찾을 수 없습니다.' });
      return;
    }
      const { studentIds, ...restData } = parsed.data;

      const [updated] = await db
        .update(adminUsers)
        .set({ ...restData, updatedAt: new Date() })
        .where(eq(adminUsers.id, id))
        .returning({
          id: adminUsers.id,
          name: adminUsers.name,
          email: adminUsers.email,
          isActive: adminUsers.isActive,
          permissions: adminUsers.permissions,
        });

      if (studentIds !== undefined) {
        await db
          .update(students)
          .set({ instructorId: null })
          .where(and(eq(students.instructorId, id), eq(students.institutionId, institutionId)));

        if (studentIds.length > 0) {
          await db
            .update(students)
            .set({ instructorId: id })
            .where(and(inArray(students.id, studentIds), eq(students.institutionId, institutionId)));
        }
      }

      res.json(updated);
  } catch (err) {
    console.error('강사 정보 수정 실패', err);
    res.status(500).json({ error: '강사 정보 수정 중 오류 발생' });
  }
});

/** DELETE /admin/instructors/:id — 강사 계정 비활성화 (소프트 삭제) */
router.delete('/instructors/:id', requireRole('admin'), async (req, res) => {
  const { institutionId } = req.user!;
  const { id } = req.params;
  try {
    const [target] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(and(eq(adminUsers.id, id), eq(adminUsers.institutionId, institutionId), eq(adminUsers.role, 'teacher')))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: '해당 강사 계정을 찾을 수 없습니다.' });
      return;
    }
    await db
      .update(adminUsers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(adminUsers.id, id));
    res.status(204).send();
  } catch (err) {
    console.error('강사 계정 비활성화 실패', err);
    res.status(500).json({ error: '강사 계정 비활성화 중 오류 발생' });
  }
});

/**
 * GET /admin/students/:studentId/submissions
 * 특정 학생이 제출한 과제(댓글 형태) 목록 조회
 * assignmentComments 테이블에서 해당 학생이 작성한 댓글로 조회합니다.
 */
router.get('/students/:studentId/submissions', async (req, res) => {
  const { studentId } = req.params;
  const { institutionId } = req.user!;

  // 해당 기관 과목의 과제에 수강생이 작성한 댓글 전체 조회
  const submissions = await db
    .select({
      commentId: assignmentComments.id,
      content: assignmentComments.content,
      createdAt: assignmentComments.createdAt,
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      dueAt: assignments.dueAt,
      courseName: courses.name,
      courseId: courses.id,
    })
    .from(assignmentComments)
    .innerJoin(assignments, eq(assignmentComments.assignmentId, assignments.id))
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .where(
      and(
        eq(assignmentComments.studentId, studentId),
        eq(courses.institutionId, institutionId),
        isNull(assignmentComments.deletedAt),
        isNull(assignments.deletedAt),
      ),
    )
    .orderBy(desc(assignmentComments.createdAt));

  res.json({ submissions });
});

export default router;

// ── 수강생 스킬 매핑 (Phase 10: Student-Skill Mapping) ───────────────────────────────────

/**
 * GET /admin/students/:studentId/skills
 * 특정 학생에게 할당된 스킬 목록 조회
 */
router.get('/students/:studentId/skills', async (req, res) => {
  const { studentId } = req.params;
  const { institutionId } = req.user!;

  const rows = await db
    .select({
      id: studentSkills.id,
      studentId: studentSkills.studentId,
      skillId: studentSkills.skillId,
      isActive: studentSkills.isActive,
      assignedAt: studentSkills.assignedAt,
      skillTitle: instructorSkills.title,
    })
    .from(studentSkills)
    .innerJoin(instructorSkills, eq(studentSkills.skillId, instructorSkills.id))
    .where(
      and(
        eq(studentSkills.studentId, studentId),
        eq(instructorSkills.institutionId, institutionId)
      )
    )
    .orderBy(desc(studentSkills.assignedAt));

  res.json({ bindings: rows });
});

/**
 * POST /admin/students/:studentId/skills
 * 수강생에게 특정 교재/상황별 스킬 매핑 (할당)
 */
router.post('/students/:studentId/skills', async (req, res) => {
  const { studentId } = req.params;
  const { skillId } = req.body;

  if (!skillId) {
    return res.status(400).json({ error: 'skillId가 필요합니다.' });
  }

  // 중복 검사
  const [existing] = await db
    .select()
    .from(studentSkills)
    .where(
      and(
        eq(studentSkills.studentId, studentId),
        eq(studentSkills.skillId, skillId)
      )
    )
    .limit(1);

  if (existing) {
    return res.status(409).json({ error: '이미 할당된 스킬입니다.' });
  }

  const [inserted] = await db
    .insert(studentSkills)
    .values({ studentId, skillId, isActive: true })
    .returning();

  res.status(201).json({ binding: inserted });
});

/**
 * DELETE /admin/students/:studentId/skills/:skillId
 * 수강생에게 할당된 스킬 매핑 해제
 */
router.delete('/students/:studentId/skills/:skillId', async (req, res) => {
  const { studentId, skillId } = req.params;

  await db
    .delete(studentSkills)
    .where(
      and(
        eq(studentSkills.studentId, studentId),
        eq(studentSkills.skillId, skillId)
      )
    );

  res.json({ message: '할당 해제되었습니다.' });
});

/**
 * GET /admin/attendance/summary
 * 전체 수강생의 출결 현황 집계 반환
 */
router.get('/attendance/summary', async (req, res) => {
  const { institutionId } = req.user!;
  try {
    // 기관 수강생 목록
    const studentRows = await db
      .select({
        id: students.id,
        displayName: students.displayName,
        email: students.email,
      })
      .from(students)
      .where(and(eq(students.institutionId, institutionId), isNull(students.deletedAt)));

    if (studentRows.length === 0) {
      res.json({ summary: [] });
      return;
    }

    const studentIds = studentRows.map(r => r.id);

    // 수강생별 수강 과목 목록
    const enrollments = await db
      .select({
        studentId: studentCourses.studentId,
        courseId: courses.id,
        courseName: courses.name,
      })
      .from(studentCourses)
      .innerJoin(courses, eq(studentCourses.courseId, courses.id))
      .where(
        and(
          inArray(studentCourses.studentId, studentIds),
          isNull(studentCourses.deletedAt),
          isNull(courses.deletedAt),
        )
      );

    // 수강생별 출결 집계
    const logs = await db
      .select({
        studentId: attendanceLogs.studentId,
        status: attendanceLogs.status,
        count: sql<number>`count(*)::int`,
      })
      .from(attendanceLogs)
      .where(
        and(
          inArray(attendanceLogs.studentId, studentIds),
          isNull(attendanceLogs.deletedAt),
        )
      )
      .groupBy(attendanceLogs.studentId, attendanceLogs.status);

    // Map 구성
    const enrollMap = new Map<string, { courseId: string; courseName: string }[]>();
    for (const e of enrollments) {
      const arr = enrollMap.get(e.studentId) ?? [];
      arr.push({ courseId: e.courseId, courseName: e.courseName });
      enrollMap.set(e.studentId, arr);
    }

    const logMap = new Map<string, Record<string, number>>();
    for (const l of logs) {
      const m = logMap.get(l.studentId) ?? {};
      m[l.status] = l.count;
      logMap.set(l.studentId, m);
    }

    const summary = studentRows.map(s => {
      const stat = logMap.get(s.id) ?? {};
      const present = stat['present'] ?? 0;
      const absent = stat['absent'] ?? 0;
      const late = stat['late'] ?? 0;
      const excused = stat['excused'] ?? 0;
      const total = present + absent + late + excused;
      const rate = total > 0 ? Math.round(((present + late) / total) * 100) : null;
      return {
        id: s.id,
        displayName: s.displayName,
        email: s.email,
        courses: enrollMap.get(s.id) ?? [],
        present,
        absent,
        late,
        excused,
        total,
        rate,
      };
    });

    res.json({ summary });
  } catch (err) {
    console.error('attendance summary 조회 실패', err);
    res.status(500).json({ error: '출결 현황 조회 중 오류 발생' });
  }
});
