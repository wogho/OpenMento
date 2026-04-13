/**
 * 출결 관리 라우터
 *
 * - GET  /attendance/courses/:courseId/matrix        — 주차×회차 그리드 조회
 * - POST /attendance/courses/:courseId/sessions      — 출석 세션 열기 (강사)
 * - PATCH /attendance/sessions/:sessionId/close      — 세션 닫기 (강사)
 * - POST /attendance/sessions/:sessionId/manual      — 강사 직접 체크
 * - GET  /attendance/sessions/active                 — 현재 활성 세션 조회 (수강생)
 * - POST /attendance/sessions/:sessionId/self-check  — 수강생 자가 체크
 * - POST /attendance/sessions/:sessionId/qr          — QR 토큰 생성 (강사)
 * - POST /attendance/qr/:token/verify                — QR 스캔 → 출석 처리 (수강생)
 */

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  attendanceLogs,
  attendanceSessions,
  qrTokens,
  courses,
  students,
  studentCourses,
  eq,
  and,
  isNull,
  desc,
  asc,
  sql,
} from '@openmento/db';

const router: ReturnType<typeof Router> = Router();
router.use(authenticate);

// ──────────────────────────────────────────────────────────────────────────────
// 헬퍼: 강사가 해당 과목 담당인지 확인
// ──────────────────────────────────────────────────────────────────────────────
async function assertInstructorOwns(courseId: string, instructorId: string, institutionId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.institutionId, institutionId),
        eq(courses.instructorId, instructorId),
        isNull(courses.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(course);
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /attendance/courses/:courseId/matrix — 주차×회차 출결 그리드
// ──────────────────────────────────────────────────────────────────────────────
router.get('/courses/:courseId/matrix', requireRole('teacher', 'admin'), async (req, res) => {
  const { institutionId, sub: instructorId, role } = req.user!;
  const { courseId } = req.params;

  // 과목 + 기관 확인 (admin은 모든 과목 접근 가능)
  const [course] = await db
    .select({ id: courses.id, name: courses.name, subject: courses.subject })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.institutionId, institutionId),
        isNull(courses.deletedAt),
      ),
    )
    .limit(1);

  if (!course) return res.status(404).json({ error: '과목을 찾을 수 없습니다.' });

  if (role === 'teacher') {
    const owns = await assertInstructorOwns(courseId, instructorId, institutionId);
    if (!owns) return res.status(403).json({ error: '담당 과목이 아닙니다.' });
  }

  // 해당 과목의 수강생 목록
  const enrolledStudents = await db
    .select({
      id: students.id,
      displayName: students.displayName,
      email: students.email,
    })
    .from(students)
    .innerJoin(studentCourses, eq(studentCourses.studentId, students.id))
    .where(
      and(
        eq(studentCourses.courseId, courseId),
        isNull(students.deletedAt),
      ),
    )
    .orderBy(asc(students.displayName));

  // 출결 세션 목록
  const sessions = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.courseId, courseId))
    .orderBy(asc(attendanceSessions.weekNo), asc(attendanceSessions.sessionNo));

  // 출결 기록
  const records = await db
    .select({
      id: attendanceLogs.id,
      studentId: attendanceLogs.studentId,
      weekNo: attendanceLogs.weekNo,
      sessionNo: attendanceLogs.sessionNo,
      status: attendanceLogs.status,
      checkMethod: attendanceLogs.checkMethod,
      attendanceDate: attendanceLogs.attendanceDate,
    })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.courseId, courseId),
        isNull(attendanceLogs.deletedAt),
      ),
    );

  // studentId → { "week_session": status } 맵 구성
  const recordMap: Record<string, Record<string, { status: string; method: string }>> = {};
  for (const r of records) {
    const key = `${r.weekNo}_${r.sessionNo}`;
    if (!recordMap[r.studentId]) recordMap[r.studentId] = {};
    recordMap[r.studentId][key] = { status: r.status ?? 'absent', method: r.checkMethod ?? 'manual' };
  }

  return res.json({
    course,
    students: enrolledStudents,
    sessions,
    records: recordMap,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /attendance/courses/:courseId/sessions — 출석 세션 열기
// ──────────────────────────────────────────────────────────────────────────────
router.post('/courses/:courseId/sessions', requireRole('teacher', 'admin'), async (req, res) => {
  const { institutionId, sub: instructorId } = req.user!;
  const { courseId } = req.params;

  const bodySchema = z.object({
    weekNo: z.number().int().min(1).max(52),
    sessionNo: z.number().int().min(1).max(20),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const owns = await assertInstructorOwns(courseId, instructorId, institutionId);
  if (!owns) return res.status(403).json({ error: '담당 과목이 아닙니다.' });

  // 기존 열린 세션이 있으면 자동으로 닫기
  await db
    .update(attendanceSessions)
    .set({ isOpen: false, closedAt: new Date() })
    .where(and(eq(attendanceSessions.courseId, courseId), eq(attendanceSessions.isOpen, true)));

  // 기존 같은 week+session이 있으면 업데이트, 없으면 삽입
  const existing = await db
    .select({ id: attendanceSessions.id })
    .from(attendanceSessions)
    .where(
      and(
        eq(attendanceSessions.courseId, courseId),
        eq(attendanceSessions.weekNo, parsed.data.weekNo),
        eq(attendanceSessions.sessionNo, parsed.data.sessionNo),
      ),
    )
    .limit(1);

  let session;
  if (existing.length > 0) {
    [session] = await db
      .update(attendanceSessions)
      .set({ isOpen: true, closedAt: null, openedAt: new Date(), sessionDate: parsed.data.sessionDate })
      .where(eq(attendanceSessions.id, existing[0]!.id))
      .returning();
  } else {
    [session] = await db
      .insert(attendanceSessions)
      .values({
        courseId,
        instructorId,
        weekNo: parsed.data.weekNo,
        sessionNo: parsed.data.sessionNo,
        sessionDate: parsed.data.sessionDate,
        isOpen: true,
      })
      .returning();
  }

  return res.status(201).json({ session });
});

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /attendance/sessions/:sessionId/close — 세션 닫기
// ──────────────────────────────────────────────────────────────────────────────
router.patch('/sessions/:sessionId/close', requireRole('teacher', 'admin'), async (req, res) => {
  const { sessionId } = req.params;

  const [session] = await db
    .update(attendanceSessions)
    .set({ isOpen: false, closedAt: new Date() })
    .where(eq(attendanceSessions.id, sessionId))
    .returning();

  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  return res.json({ session });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /attendance/sessions/:sessionId/manual — 강사 직접 출결 입력
// ──────────────────────────────────────────────────────────────────────────────
router.post('/sessions/:sessionId/manual', requireRole('teacher', 'admin'), async (req, res) => {
  const { sub: instructorId } = req.user!;
  const { sessionId } = req.params;

  const bodySchema = z.object({
    records: z.array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(['present', 'absent', 'late', 'excused']),
      }),
    ).min(1),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const [sess] = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.id, sessionId))
    .limit(1);

  if (!sess) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

  const studentIds = parsed.data.records.map((r) => r.studentId);

  // upsert: 같은 courseId + studentId + week + session 이면 status 업데이트
  for (const rec of parsed.data.records) {
    await db
      .insert(attendanceLogs)
      .values({
        studentId: rec.studentId,
        courseId: sess.courseId,
        attendanceDate: sess.sessionDate,
        weekNo: sess.weekNo,
        sessionNo: sess.sessionNo,
        status: rec.status,
        checkMethod: 'manual',
        recordedBy: instructorId,
        sourceSystem: 'manual',
      })
      .onConflictDoNothing(); // 충돌 시 무시 → 별도 UPDATE

    // status 업데이트 (동일 week+session 기록 존재 시)
    await db
      .update(attendanceLogs)
      .set({ status: rec.status, checkMethod: 'manual', recordedBy: instructorId })
      .where(
        and(
          eq(attendanceLogs.studentId, rec.studentId),
          eq(attendanceLogs.courseId, sess.courseId),
          sql`${attendanceLogs.weekNo} = ${sess.weekNo}`,
          sql`${attendanceLogs.sessionNo} = ${sess.sessionNo}`,
          isNull(attendanceLogs.deletedAt),
        ),
      );
  }

  return res.json({ updated: studentIds.length });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /attendance/sessions/active?courseId=...  — 현재 활성 세션 (수강생용)
// ──────────────────────────────────────────────────────────────────────────────
router.get('/sessions/active', async (req, res) => {
  const courseId = req.query['courseId'] as string | undefined;
  if (!courseId) return res.status(400).json({ error: 'courseId 필수' });

  const [session] = await db
    .select()
    .from(attendanceSessions)
    .where(
      and(
        eq(attendanceSessions.courseId, courseId),
        eq(attendanceSessions.isOpen, true),
      ),
    )
    .orderBy(desc(attendanceSessions.openedAt))
    .limit(1);

  if (!session) return res.json({ session: null });

  // 수강생이 이미 체크했는지 확인
  const { sub: studentId } = req.user!;
  const [existing] = await db
    .select({ id: attendanceLogs.id, status: attendanceLogs.status })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.studentId, studentId),
        eq(attendanceLogs.courseId, courseId),
        sql`${attendanceLogs.weekNo} = ${session.weekNo}`,
        sql`${attendanceLogs.sessionNo} = ${session.sessionNo}`,
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .limit(1);

  return res.json({ session, alreadyChecked: Boolean(existing), myStatus: existing?.status ?? null });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /attendance/sessions/:sessionId/self-check — 수강생 자가 체크
// ──────────────────────────────────────────────────────────────────────────────
router.post('/sessions/:sessionId/self-check', async (req, res) => {
  const { sub: studentId } = req.user!;
  const { sessionId } = req.params;

  const [sess] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.id, sessionId), eq(attendanceSessions.isOpen, true)))
    .limit(1);

  if (!sess) return res.status(404).json({ error: '활성화된 출석 세션이 없습니다.' });

  // 중복 체크 방지
  const [existing] = await db
    .select({ id: attendanceLogs.id })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.studentId, studentId),
        eq(attendanceLogs.courseId, sess.courseId),
        sql`${attendanceLogs.weekNo} = ${sess.weekNo}`,
        sql`${attendanceLogs.sessionNo} = ${sess.sessionNo}`,
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .limit(1);

  if (existing) return res.status(409).json({ error: '이미 출석 처리되었습니다.' });

  const [log] = await db
    .insert(attendanceLogs)
    .values({
      studentId,
      courseId: sess.courseId,
      attendanceDate: sess.sessionDate,
      weekNo: sess.weekNo,
      sessionNo: sess.sessionNo,
      status: 'present',
      checkMethod: 'self',
      recordedBy: studentId,
      sourceSystem: 'manual',
    })
    .returning();

  return res.status(201).json({ log });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /attendance/sessions/:sessionId/qr — QR 토큰 생성 (강사)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/sessions/:sessionId/qr', requireRole('teacher', 'admin'), async (req, res) => {
  const { sessionId } = req.params;

  const [sess] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.id, sessionId), eq(attendanceSessions.isOpen, true)))
    .limit(1);

  if (!sess) return res.status(404).json({ error: '활성화된 세션이 없습니다.' });

  // 기존 미만료 토큰 무효화(재생성)
  await db.delete(qrTokens).where(eq(qrTokens.sessionId, sessionId));

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5분 후 만료

  const [qr] = await db
    .insert(qrTokens)
    .values({ sessionId, token, expiresAt })
    .returning();

  // QR이 담을 URL (수강생이 스캔하면 이 URL로 이동)
  const verifyUrl = `${process.env.PUBLIC_URL ?? 'http://localhost:5173'}/attendance/qr/${token}`;

  return res.status(201).json({ qr, verifyUrl, expiresAt });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /attendance/qr/:token/verify — QR 스캔 출석 처리 (수강생)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/qr/:token/verify', async (req, res) => {
  const { sub: studentId } = req.user!;
  const { token } = req.params;

  const [qr] = await db
    .select()
    .from(qrTokens)
    .where(eq(qrTokens.token, token))
    .limit(1);

  if (!qr) return res.status(404).json({ error: '유효하지 않은 QR 코드입니다.' });
  if (qr.expiresAt < new Date()) return res.status(410).json({ error: 'QR 코드가 만료되었습니다.' });

  const [sess] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.id, qr.sessionId), eq(attendanceSessions.isOpen, true)))
    .limit(1);

  if (!sess) return res.status(404).json({ error: '출석 세션이 닫혔습니다.' });

  // 중복 확인
  const [existing] = await db
    .select({ id: attendanceLogs.id })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.studentId, studentId),
        eq(attendanceLogs.courseId, sess.courseId),
        sql`${attendanceLogs.weekNo} = ${sess.weekNo}`,
        sql`${attendanceLogs.sessionNo} = ${sess.sessionNo}`,
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .limit(1);

  if (existing) return res.status(409).json({ error: '이미 출석 처리되었습니다.' });

  const [log] = await db
    .insert(attendanceLogs)
    .values({
      studentId,
      courseId: sess.courseId,
      attendanceDate: sess.sessionDate,
      weekNo: sess.weekNo,
      sessionNo: sess.sessionNo,
      status: 'present',
      checkMethod: 'qr',
      recordedBy: studentId,
      sourceSystem: 'manual',
    })
    .returning();

  // QR 사용 횟수 증가
  await db
    .update(qrTokens)
    .set({ usedCount: sql`${qrTokens.usedCount} + 1` })
    .where(eq(qrTokens.id, qr.id));

  return res.status(201).json({ log, message: '출석이 확인되었습니다.' });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /attendance/sessions/:sessionId — 세션 상세 + QR 현황
// ──────────────────────────────────────────────────────────────────────────────
router.get('/sessions/:sessionId', requireRole('teacher', 'admin'), async (req, res) => {
  const { sessionId } = req.params;

  const [sess] = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.id, sessionId))
    .limit(1);

  if (!sess) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });

  const [qr] = await db
    .select()
    .from(qrTokens)
    .where(eq(qrTokens.sessionId, sessionId))
    .orderBy(desc(qrTokens.createdAt))
    .limit(1);

  return res.json({ session: sess, qr: qr ?? null });
});

export default router;
