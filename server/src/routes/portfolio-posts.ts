/**
 * /portfolio-posts/* — 포트폴리오 게시물 CRUD + 댓글 (강사 관리 + 수강생 작성)
 *
 * POST   /portfolio-posts/upload                          → 파일 업로드 (수강생·강사)
 * GET    /portfolio-posts/course/:courseId                → 과목별 포트폴리오 목록 (강사)
 * GET    /portfolio-posts/my                              → 내 포트폴리오 목록 (수강생)
 * GET    /portfolio-posts/admin/all                       → 전체 목록 (관리자·강사)
 * POST   /portfolio-posts                                 → 포트폴리오 생성 (수강생)
 * GET    /portfolio-posts/:postId                         → 상세 조회 + 댓글
 * PATCH  /portfolio-posts/:postId                         → 수정 (본인 수강생)
 * DELETE /portfolio-posts/:postId                         → 삭제 (본인 or 강사)
 * PATCH  /portfolio-posts/:postId/status                  → 상태 변경 submitted/reviewed (강사)
 * POST   /portfolio-posts/:postId/comments               → 댓글 작성 (누구나)
 * DELETE /portfolio-posts/comments/:commentId            → 댓글 삭제 (본인)
 */
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  portfolioPosts,
  portfolioPostComments,
  courses,
  students,
  studentCourses,
  eq,
  and,
  isNull,
  desc,
  inArray,
} from '@openmento/db';
import { callAgent } from '../services/agent-runner.js';

// ── 파일 업로드 ──────────────────────────────────────────────────────────────
const PORTFOLIO_UPLOAD_DIR = process.env.PORTFOLIO_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads', 'portfolios');
mkdirSync(PORTFOLIO_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PORTFOLIO_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `portfolio-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Zod 스키마 ────────────────────────────────────────────────────────────────
const createPostSchema = z.object({
  courseId: z.string().uuid(),
  title:    z.string().min(1).max(200),
  content:  z.string().max(20000).default(''),
  fileUrl:  z.string().url().optional().or(z.literal('')),
  fileName: z.string().max(300).optional(),
});

const updatePostSchema = z.object({
  title:   z.string().min(1).max(200).optional(),
  content: z.string().max(20000).optional(),
  fileUrl: z.string().url().optional().or(z.literal('')).nullable(),
  fileName: z.string().max(300).optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(['submitted', 'reviewed']),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  agentId: z.string().uuid().optional(), // AI 댓글인 경우
});

const router: ReturnType<typeof Router> = Router();
router.use(authenticate);

// ── POST /portfolio-posts/upload ─────────────────────────────────────────────
router.post('/upload', requireRole('student', 'teacher', 'admin'), upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: '파일이 없습니다.' }); return; }
  const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
  res.json({ url: `/uploads/portfolios/${file.filename}`, fileName: originalName });
});

// ── GET /portfolio-posts/my — 수강생 본인 목록 ────────────────────────────────
router.get('/my', requireRole('student'), async (req, res) => {
  const studentId = req.user!.sub;
  try {
    const posts = await db
      .select({
        id: portfolioPosts.id,
        title: portfolioPosts.title,
        status: portfolioPosts.status,
        fileUrl: portfolioPosts.fileUrl,
        fileName: portfolioPosts.fileName,
        createdAt: portfolioPosts.createdAt,
        updatedAt: portfolioPosts.updatedAt,
        courseId: portfolioPosts.courseId,
        courseName: courses.name,
      })
      .from(portfolioPosts)
      .leftJoin(courses, eq(portfolioPosts.courseId, courses.id))
      .where(and(eq(portfolioPosts.studentId, studentId), isNull(portfolioPosts.deletedAt)))
      .orderBy(desc(portfolioPosts.createdAt));
    res.json({ posts });
  } catch (err) {
    console.error('[portfolio-posts/my]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── GET /portfolio-posts/admin/all — 강사·관리자 전체 목록 ────────────────────
router.get('/admin/all', requireRole('teacher', 'admin'), async (req, res) => {
  const { role, sub: userId } = req.user!;
  const { courseId, studentId: qStudentId } = req.query as Record<string, string | undefined>;
  try {
    const conditions: ReturnType<typeof and>[] = [isNull(portfolioPosts.deletedAt)];

    // 강사는 본인이 담당하는 과목의 포트폴리오만 조회
    if (role === 'teacher') {
      const myCourses = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.instructorId, userId), isNull(courses.deletedAt)));
      const courseIds = myCourses.map(c => c.id);
      if (courseIds.length === 0) { res.json({ posts: [] }); return; }
      conditions.push(inArray(portfolioPosts.courseId, courseIds));
    }
    if (courseId) conditions.push(eq(portfolioPosts.courseId, courseId));
    if (qStudentId) conditions.push(eq(portfolioPosts.studentId, qStudentId));

    const posts = await db
      .select({
        id: portfolioPosts.id,
        title: portfolioPosts.title,
        status: portfolioPosts.status,
        fileUrl: portfolioPosts.fileUrl,
        fileName: portfolioPosts.fileName,
        createdAt: portfolioPosts.createdAt,
        updatedAt: portfolioPosts.updatedAt,
        courseId: portfolioPosts.courseId,
        courseName: courses.name,
        studentId: portfolioPosts.studentId,
        studentName: students.displayName,
      })
      .from(portfolioPosts)
      .leftJoin(courses, eq(portfolioPosts.courseId, courses.id))
      .leftJoin(students, eq(portfolioPosts.studentId, students.id))
      .where(and(...conditions))
      .orderBy(desc(portfolioPosts.createdAt));

    res.json({ posts });
  } catch (err) {
    console.error('[portfolio-posts/admin/all]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── POST /portfolio-posts — 포트폴리오 생성 (수강생) ──────────────────────────
router.post('/', requireRole('student'), async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: '입력값 검증 실패', details: parsed.error.flatten() }); return; }

  const studentId = req.user!.sub;
  const { courseId, title, content, fileUrl, fileName } = parsed.data;

  try {
    // 수강생이 해당 과목에 등록되어 있는지 확인
    const [enrollment] = await db
      .select({ id: studentCourses.id })
      .from(studentCourses)
      .where(and(
        eq(studentCourses.studentId, studentId),
        eq(studentCourses.courseId, courseId),
        isNull(studentCourses.deletedAt),
      ));
    if (!enrollment) { res.status(403).json({ error: '해당 과목에 등록되어 있지 않습니다.' }); return; }

    const [post] = await db.insert(portfolioPosts).values({
      studentId,
      courseId,
      title,
      content,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      status: 'draft',
    }).returning();

    res.status(201).json({ post });
  } catch (err) {
    console.error('[portfolio-posts POST]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── GET /portfolio-posts/:postId — 상세 + 댓글 ────────────────────────────────
router.get('/:postId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { postId } = req.params;
  const { sub: userId, role } = req.user!;
  try {
    const [post] = await db
      .select({
        id: portfolioPosts.id,
        studentId: portfolioPosts.studentId,
        courseId: portfolioPosts.courseId,
        title: portfolioPosts.title,
        content: portfolioPosts.content,
        fileUrl: portfolioPosts.fileUrl,
        fileName: portfolioPosts.fileName,
        status: portfolioPosts.status,
        createdAt: portfolioPosts.createdAt,
        updatedAt: portfolioPosts.updatedAt,
        courseName: courses.name,
        studentName: students.displayName,
      })
      .from(portfolioPosts)
      .leftJoin(courses, eq(portfolioPosts.courseId, courses.id))
      .leftJoin(students, eq(portfolioPosts.studentId, students.id))
      .where(and(eq(portfolioPosts.id, postId), isNull(portfolioPosts.deletedAt)));

    if (!post) { res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' }); return; }
    // 수강생은 본인 것만
    if (role === 'student' && post.studentId !== userId) {
      res.status(403).json({ error: '접근 권한이 없습니다.' }); return;
    }

    const comments = await db
      .select()
      .from(portfolioPostComments)
      .where(and(eq(portfolioPostComments.postId, postId), isNull(portfolioPostComments.deletedAt)))
      .orderBy(portfolioPostComments.createdAt);

    res.json({ post, comments });
  } catch (err) {
    console.error('[portfolio-posts/:id GET]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── PATCH /portfolio-posts/:postId — 수정 (본인 수강생) ─────────────────────
router.patch('/:postId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { postId } = req.params;
  const { sub: userId, role } = req.user!;
  const parsed = updatePostSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: '입력값 검증 실패', details: parsed.error.flatten() }); return; }

  try {
    const [post] = await db.select({ studentId: portfolioPosts.studentId })
      .from(portfolioPosts)
      .where(and(eq(portfolioPosts.id, postId), isNull(portfolioPosts.deletedAt)));
    if (!post) { res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' }); return; }
    if (role === 'student' && post.studentId !== userId) {
      res.status(403).json({ error: '본인 포트폴리오만 수정할 수 있습니다.' }); return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.content !== undefined) updates.content = parsed.data.content;
    if (parsed.data.fileUrl !== undefined) updates.fileUrl = parsed.data.fileUrl ?? null;
    if (parsed.data.fileName !== undefined) updates.fileName = parsed.data.fileName ?? null;

    const [updated] = await db.update(portfolioPosts).set(updates).where(eq(portfolioPosts.id, postId)).returning();
    res.json({ post: updated });
  } catch (err) {
    console.error('[portfolio-posts/:id PATCH]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── DELETE /portfolio-posts/:postId ──────────────────────────────────────────
router.delete('/:postId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { postId } = req.params;
  const { sub: userId, role } = req.user!;
  try {
    const [post] = await db.select({ studentId: portfolioPosts.studentId })
      .from(portfolioPosts)
      .where(and(eq(portfolioPosts.id, postId), isNull(portfolioPosts.deletedAt)));
    if (!post) { res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' }); return; }
    if (role === 'student' && post.studentId !== userId) {
      res.status(403).json({ error: '본인 포트폴리오만 삭제할 수 있습니다.' }); return;
    }

    await db.update(portfolioPosts).set({ deletedAt: new Date() }).where(eq(portfolioPosts.id, postId));
    res.json({ success: true });
  } catch (err) {
    console.error('[portfolio-posts/:id DELETE]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── PATCH /portfolio-posts/:postId/status — 강사가 상태 변경 ─────────────────
router.patch('/:postId/status', requireRole('teacher', 'admin'), async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: '입력값 검증 실패' }); return; }
  try {
    const [updated] = await db.update(portfolioPosts)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(portfolioPosts.id, req.params.postId), isNull(portfolioPosts.deletedAt)))
      .returning();
    if (!updated) { res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' }); return; }
    res.json({ post: updated });
  } catch (err) {
    console.error('[portfolio-posts/:id/status PATCH]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── POST /portfolio-posts/:postId/comments — 댓글 작성 ───────────────────────
router.post('/:postId/comments', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { postId } = req.params;
    const { sub: userId, role, name, institutionId } = req.user!;
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: '입력값 검증 실패', details: parsed.error.flatten() }); return; }

  try {
    const [post] = await db.select({ studentId: portfolioPosts.studentId, courseId: portfolioPosts.courseId, content: portfolioPosts.content, title: portfolioPosts.title })
      .from(portfolioPosts)
      .where(and(eq(portfolioPosts.id, postId), isNull(portfolioPosts.deletedAt)));
    if (!post) { res.status(404).json({ error: '포트폴리오를 찾을 수 없습니다.' }); return; }
    // 수강생은 본인 것에만 댓글 가능
    if (role === 'student' && post.studentId !== userId) {
      res.status(403).json({ error: '접근 권한이 없습니다.' }); return;
    }

    const { agentId, content } = parsed.data;
    const authorType: 'student' | 'instructor' | 'agent' = agentId ? 'agent' : role === 'student' ? 'student' : 'instructor';

    // 1️⃣ 댓글을 즉시 저장 (AI는 아직 처리 전, 원문 content를 일단 저장)
    const [comment] = await db.insert(portfolioPostComments).values({
      postId,
      authorId: userId,
      authorType,
      agentId: agentId ?? null,
      authorName: name ?? null,
      content: agentId ? `⏳ AI가 분석 중입니다... (요청: ${content})` : content,
    }).returning();

    // 2️⃣ HTTP 201을 즉시 반환 (클라이언트 블로킹 없음)
    res.status(201).json({ comment });

    // 3️⃣ AI 호출은 백그라운드 fire-and-forget (응답 후 댓글 업데이트)
    if (agentId) {
      const prompt = `다음 포트폴리오를 분석하고 피드백을 제공해주세요.\n\n제목: ${post.title}\n\n내용:\n${post.content}\n\n요청: ${content}`;
      callAgent({ agentId, institutionId, userMessage: prompt })
        .then(async (aiReply) => {
          await db.update(portfolioPostComments)
            .set({ content: aiReply ?? `[에이전트가 응답을 반환하지 않았습니다] 요청: ${content}` })
            .where(eq(portfolioPostComments.id, comment.id));
        })
        .catch((agentErr) => {
          console.error('[portfolio comment agent bg]', agentErr);
          db.update(portfolioPostComments)
            .set({ content: `[에이전트 오류] ${content}` })
            .where(eq(portfolioPostComments.id, comment.id))
            .catch(() => {});
        });
    }
  } catch (err) {
    console.error('[portfolio-posts/:id/comments POST]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ── DELETE /portfolio-posts/comments/:commentId ──────────────────────────────
router.delete('/comments/:commentId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { commentId } = req.params;
  const { sub: userId, role } = req.user!;
  try {
    const [comment] = await db.select({ authorId: portfolioPostComments.authorId })
      .from(portfolioPostComments)
      .where(and(eq(portfolioPostComments.id, commentId), isNull(portfolioPostComments.deletedAt)));
    if (!comment) { res.status(404).json({ error: '댓글을 찾을 수 없습니다.' }); return; }
    if (role === 'student' && comment.authorId !== userId) {
      res.status(403).json({ error: '본인 댓글만 삭제할 수 있습니다.' }); return;
    }
    await db.update(portfolioPostComments).set({ deletedAt: new Date() }).where(eq(portfolioPostComments.id, commentId));
    res.json({ success: true });
  } catch (err) {
    console.error('[portfolio-posts/comments/:id DELETE]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
