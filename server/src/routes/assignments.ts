/**
 * /assignments/* — 과제 CRUD + 댓글 스레드
 *
 * 라우트 구조:
 *  POST   /assignments/upload                    → 과제 첨부파일 업로드 (강사 전용)
 *  GET    /assignments/course/:courseId          → 과목의 과제 목록 (강사·수강생 공통)
 *  POST   /assignments/course/:courseId          → 과제 생성 (강사 전용)
 *  GET    /assignments/:assignmentId             → 과제 상세 + 댓글 목록
 *  PATCH  /assignments/:assignmentId             → 과제 수정 (강사 전용)
 *  DELETE /assignments/:assignmentId             → 과제 삭제 (soft, 강사 전용)
 *  POST   /assignments/:assignmentId/comments    → 댓글 작성 (강사·수강생 공통)
 *  DELETE /assignments/comments/:commentId       → 댓글 삭제 (본인만)
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  assignments,
  assignmentComments,
  courses,
  adminUsers,
  students,
  studentCourses,
  instructorNotifications,
  eq,
  and,
  isNull,
  desc,
  asc,
} from '@openmento/db';
import type { NewInstructorNotification } from '@openmento/db';
import { io } from '../socket/chat.handler.js';

// ── 과제 첨부파일 업로드 설정 ────────────────────────────────────────────────
const ASSIGN_UPLOAD_DIR = process.env.ASSIGN_UPLOAD_DIR ?? path.join(process.cwd(), 'uploads', 'assignments');
mkdirSync(ASSIGN_UPLOAD_DIR, { recursive: true });

const assignUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ASSIGN_UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `assign-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const singleAssignUpload = (req: Request, res: Response, next: NextFunction) => {
  assignUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      res.status(413).json({ error: '파일 크기가 50MB를 초과합니다.' });
      return;
    }
    if (err) {
      res.status(400).json({ error: String(err) });
      return;
    }
    next();
  });
};

const router: ReturnType<typeof Router> = Router();
router.use(authenticate);

// ── 파일 업로드 (강사 전용) ───────────────────────────────────────────────────
// multipart/form-data: field "file"
// 응답: { url: string; fileName: string }
router.post('/upload', requireRole('teacher', 'admin'), singleAssignUpload, (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: '파일이 없습니다.' });
    return;
  }
  // multer는 Content-Disposition filename을 latin1로 디코딩하므로 UTF-8로 재변환
  const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
  res.json({
    url: `/uploads/assignments/${file.filename}`,
    fileName: originalName,
  });
});

// ── 유효성 검증 스키마 ───────────────────────────────────────────────────────

const createAssignmentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  fileUrl: z.string().min(1).optional().nullable(),  // 상대경로(/uploads/...)도 허용
  fileName: z.string().max(255).optional().nullable(),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parentId: z.string().uuid().optional().nullable(),
});

// ── 과목별 과제 목록 ─────────────────────────────────────────────────────────

router.get('/course/:courseId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { courseId } = req.params;
  const { sub: userId, role } = req.user!;

  // 수강생인 경우 과목 접근 권한 검증
  if (role === 'student') {
    const enrollment = await db.query.studentCourses.findFirst({
      where: and(
        eq(studentCourses.studentId, userId),
        eq(studentCourses.courseId, courseId),
        isNull(studentCourses.deletedAt),
      ),
    });
    if (!enrollment) {
      res.status(403).json({ error: '해당 과목의 수강생이 아닙니다.' });
      return;
    }
  }

  const rows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      content: assignments.content,
      fileUrl: assignments.fileUrl,
      fileName: assignments.fileName,
      dueAt: assignments.dueAt,
      isPublished: assignments.isPublished,
      createdAt: assignments.createdAt,
      instructorName: adminUsers.name,
    })
    .from(assignments)
    .leftJoin(adminUsers, eq(assignments.instructorId, adminUsers.id))
    .where(
      and(
        eq(assignments.courseId, courseId),
        isNull(assignments.deletedAt),
        // 수강생은 공개된 과제만 조회
        ...(role === 'student' ? [eq(assignments.isPublished, true)] : []),
      ),
    )
    .orderBy(desc(assignments.createdAt));

  res.json({ assignments: rows });
});

// ── 과제 생성 (강사 전용) ────────────────────────────────────────────────────

router.post('/course/:courseId', requireRole('teacher', 'admin'), async (req, res) => {
  const { courseId } = req.params;
  const { sub: instructorId } = req.user!;

  const parsed = createAssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '입력값 검증 실패', details: parsed.error.flatten() });
    return;
  }

  const { title, content, dueAt, fileUrl, fileName } = parsed.data;

  // 과목 존재 확인
  const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
  if (!course) {
    res.status(404).json({ error: '과목을 찾을 수 없습니다.' });
    return;
  }

  const [newAssignment] = await db
    .insert(assignments)
    .values({
      courseId,
      instructorId,
      title,
      content,
      dueAt: dueAt ? new Date(dueAt) : null,
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
    })
    .returning();

  // ── 소켓 알림: 해당 과목 수강생 전원에게 System Message 과제 알림 ───────
  // 수강생들의 student:<id> 룸에 'assignment_posted' 이벤트 push
  if (io) {
    const enrollments = await db.query.studentCourses.findMany({
      where: and(eq(studentCourses.courseId, courseId), isNull(studentCourses.deletedAt)),
    });
    for (const enrollment of enrollments) {
      io.to(`student:${enrollment.studentId}`).emit('assignment_posted', {
        assignmentId: newAssignment!.id,
        title: newAssignment!.title,
        dueAt: newAssignment!.dueAt,
        courseId,
        courseName: course.name,
      });
    }
  }

  res.status(201).json({ assignment: newAssignment });
});

// ── 과제 상세 + 댓글 ─────────────────────────────────────────────────────────

router.get('/:assignmentId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { assignmentId } = req.params;
  const { sub: userId, role } = req.user!;

  const assignment = await db.query.assignments.findFirst({
    where: and(eq(assignments.id, assignmentId), isNull(assignments.deletedAt)),
  });
  if (!assignment) {
    res.status(404).json({ error: '과제를 찾을 수 없습니다.' });
    return;
  }

  // 수강생: 과목 등록 여부 확인
  if (role === 'student') {
    const enrollment = await db.query.studentCourses.findFirst({
      where: and(
        eq(studentCourses.studentId, userId),
        eq(studentCourses.courseId, assignment.courseId),
        isNull(studentCourses.deletedAt),
      ),
    });
    if (!enrollment) {
      res.status(403).json({ error: '해당 과목의 수강생이 아닙니다.' });
      return;
    }
  }

  // 댓글 (삭제되지 않은 것만)
  const comments = await db
    .select({
      id: assignmentComments.id,
      content: assignmentComments.content,
      authorRole: assignmentComments.authorRole,
      parentId: assignmentComments.parentId,
      createdAt: assignmentComments.createdAt,
      instructorId: assignmentComments.instructorId,
      studentId: assignmentComments.studentId,
      instructorName: adminUsers.name,
      studentName: students.displayName,
    })
    .from(assignmentComments)
    .leftJoin(adminUsers, eq(assignmentComments.instructorId, adminUsers.id))
    .leftJoin(students, eq(assignmentComments.studentId, students.id))
    .where(
      and(eq(assignmentComments.assignmentId, assignmentId), isNull(assignmentComments.deletedAt)),
    )
    .orderBy(asc(assignmentComments.createdAt));

  res.json({ assignment, comments });
});

// ── 과제 수정 (강사 전용) ────────────────────────────────────────────────────

router.patch('/:assignmentId', requireRole('teacher', 'admin'), async (req, res) => {
  const { assignmentId } = req.params;
  const { sub: instructorId } = req.user!;

  const parsed = createAssignmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '입력값 검증 실패', details: parsed.error.flatten() });
    return;
  }

  const existing = await db.query.assignments.findFirst({
    where: and(
      eq(assignments.id, assignmentId),
      eq(assignments.instructorId, instructorId),
      isNull(assignments.deletedAt),
    ),
  });
  if (!existing) {
    res.status(404).json({ error: '과제를 찾을 수 없거나 수정 권한이 없습니다.' });
    return;
  }

  const { title, content, dueAt, fileUrl, fileName } = parsed.data;
  const [updated] = await db
    .update(assignments)
    .set({
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(dueAt !== undefined && { dueAt: dueAt ? new Date(dueAt) : null }),
      ...(fileUrl !== undefined && { fileUrl }),
      ...(fileName !== undefined && { fileName }),
      updatedAt: new Date(),
    })
    .where(eq(assignments.id, assignmentId))
    .returning();

  res.json({ assignment: updated });
});

// ── 과제 삭제 (soft delete, 강사 전용) ──────────────────────────────────────

router.delete('/:assignmentId', requireRole('teacher', 'admin'), async (req, res) => {
  const { assignmentId } = req.params;
  const { sub: instructorId } = req.user!;

  const existing = await db.query.assignments.findFirst({
    where: and(
      eq(assignments.id, assignmentId),
      eq(assignments.instructorId, instructorId),
      isNull(assignments.deletedAt),
    ),
  });
  if (!existing) {
    res.status(404).json({ error: '과제를 찾을 수 없거나 삭제 권한이 없습니다.' });
    return;
  }

  await db
    .update(assignments)
    .set({ deletedAt: new Date() })
    .where(eq(assignments.id, assignmentId));

  res.json({ ok: true });
});

// ── 댓글 작성 ────────────────────────────────────────────────────────────────

router.post('/:assignmentId/comments', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { assignmentId } = req.params;
  const { sub: userId, role } = req.user!;

  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '입력값 검증 실패', details: parsed.error.flatten() });
    return;
  }

  const assignment = await db.query.assignments.findFirst({
    where: and(eq(assignments.id, assignmentId), isNull(assignments.deletedAt)),
  });
  if (!assignment) {
    res.status(404).json({ error: '과제를 찾을 수 없습니다.' });
    return;
  }

  // 수강생: 해당 과목 등록 여부 확인
  if (role === 'student') {
    const enrollment = await db.query.studentCourses.findFirst({
      where: and(
        eq(studentCourses.studentId, userId),
        eq(studentCourses.courseId, assignment.courseId),
        isNull(studentCourses.deletedAt),
      ),
    });
    if (!enrollment) {
      res.status(403).json({ error: '해당 과목의 수강생이 아닙니다.' });
      return;
    }
  }

  const { content, parentId } = parsed.data;
  const isInstructor = role === 'teacher' || role === 'admin';

  const [comment] = await db
    .insert(assignmentComments)
    .values({
      assignmentId,
      instructorId: isInstructor ? userId : null,
      studentId: isInstructor ? null : userId,
      authorRole: isInstructor ? 'instructor' : 'student',
      content,
      parentId: parentId ?? null,
    })
    .returning();

  // 수강생이 댓글(과제 제출)한 경우 → 과제 담당 강사에게 알림 발송
  if (!isInstructor && comment) {
    try {
      const [studentRow] = await db
        .select({ displayName: students.displayName })
        .from(students)
        .where(eq(students.id, userId))
        .limit(1);

      const studentName = studentRow?.displayName ?? '수강생';
      const notifMessage = `${studentName}이(가) '${assignment.title}' 과제를 제출했습니다.`;

      const [notif] = await db
        .insert(instructorNotifications)
        .values({
          instructorId: assignment.instructorId,
          studentId: userId,
          courseId: assignment.courseId,
          type: 'assignment_submitted',
          message: notifMessage,
        } as NewInstructorNotification)
        .returning({ id: instructorNotifications.id });

      // 강사에게 소켓 알림 push
      if (io && notif?.id) {
        const [courseRow] = await db
          .select({ name: courses.name })
          .from(courses)
          .where(eq(courses.id, assignment.courseId))
          .limit(1);

        io.to(`user:${assignment.instructorId}`).emit('instructor_notification', {
          notificationId: notif.id,
          type: 'assignment_submitted',
          message: notifMessage,
          studentName,
          courseName: courseRow?.name ?? '',
          assignmentTitle: assignment.title,
          assignmentId: assignment.id,
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      // 알림 실패가 댓글 저장을 막지 않도록 무시
    }
  }

  res.status(201).json({ comment });
});

// ── 댓글 삭제 (soft delete, 본인만) ─────────────────────────────────────────

router.delete('/comments/:commentId', requireRole('student', 'teacher', 'admin'), async (req, res) => {
  const { commentId } = req.params;
  const { sub: userId } = req.user!;

  const existing = await db.query.assignmentComments.findFirst({
    where: and(eq(assignmentComments.id, commentId), isNull(assignmentComments.deletedAt)),
  });
  if (!existing) {
    res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
    return;
  }

  // 본인 확인 (강사 또는 수강생)
  const isOwner = existing.instructorId === userId || existing.studentId === userId;
  if (!isOwner) {
    res.status(403).json({ error: '본인 댓글만 삭제할 수 있습니다.' });
    return;
  }

  await db
    .update(assignmentComments)
    .set({ deletedAt: new Date() })
    .where(eq(assignmentComments.id, commentId));

  res.json({ ok: true });
});

export default router;
