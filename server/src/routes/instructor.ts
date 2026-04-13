import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  db,
  students,
  ewsRiskScores,
  instructorNotifications,
  instructorChatMessages,
  courses,
  eq,
  and,
  isNull,
  sql,
  desc,
  gte,
  asc,
} from '@openmento/db';
import { io } from '../socket/chat.handler.js';

const router: ReturnType<typeof Router> = Router();

// 모든 /instructor/* 라우트에 인증 + 역할 검증 적용
// teacher / admin만 접근 가능
router.use(authenticate);
router.use(requireRole('teacher', 'admin'));

// GET /instructor/me — 강사 본인 정보 조회
router.get('/me', (req, res) => {
  const { sub, institutionId } = req.user!;
  res.json({ userId: sub, institutionId });
});

// GET /instructor/courses — 담당 과목 목록 (출결 관리 등에서 사용)
router.get('/courses', async (req, res) => {
  const { institutionId, sub: instructorId, role } = req.user!;

  const where = role === 'admin'
    ? and(eq(courses.institutionId, institutionId), isNull(courses.deletedAt))
    : and(eq(courses.institutionId, institutionId), eq(courses.instructorId, instructorId), isNull(courses.deletedAt));

  const rows = await db
    .select({ id: courses.id, name: courses.name, subject: courses.subject })
    .from(courses)
    .where(where)
    .orderBy(asc(courses.name));

  res.json({ courses: rows });
});

// GET /instructor/students — 담당 수강생 현황 (최근 EWS 점수 포함, 페이지네이션 지원)
// 쿼리: ?limit=20&offset=0
router.get('/students', async (req, res) => {
  const { institutionId, sub: instructorId } = req.user!;

  const limitRaw = parseInt(req.query['limit'] as string ?? '20', 10);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 20 : Math.min(limitRaw, 100);
  const offsetRaw = parseInt(req.query['offset'] as string ?? '0', 10);
  const offset = isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;

  // 수강생 목록 + 가장 최근 EWS 점수 서브쿼리
  const latestScoreSubq = db
    .select({
      studentId: ewsRiskScores.studentId,
      totalScore: sql<number>`max(${ewsRiskScores.totalScore})`.as('latest_score'),
      calculatedAt: sql<Date>`max(${ewsRiskScores.calculatedAt})`.as('latest_calculated_at'),
    })
    .from(ewsRiskScores)
    .groupBy(ewsRiskScores.studentId)
    .as('latest_scores');

  const rows = await db
    .select({
      id: students.id,
      anonymousId: students.anonymousId,
      displayName: students.displayName,
      githubRepo: students.githubRepo,
      courseId: students.courseId,
      enrolledAt: students.enrolledAt,
      latestScore: latestScoreSubq.totalScore,
      scoreCalculatedAt: latestScoreSubq.calculatedAt,
    })
    .from(students)
    .leftJoin(latestScoreSubq, eq(latestScoreSubq.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        isNull(students.deletedAt),
      ),
    )
    .orderBy(desc(latestScoreSubq.totalScore))
    .limit(limit)
    .offset(offset);

  // 전체 수강생 수 (페이지네이션 메타 반환용)
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(students)
    .where(and(eq(students.institutionId, institutionId), isNull(students.deletedAt)));

  // 미확인 호출 알림을 수강생별로 매핑하여 채팅 버튼 상태에 반영합니다.
  const pendingCallRows = await db
    .select({
      id: instructorNotifications.id,
      studentId: instructorNotifications.studentId,
      createdAt: instructorNotifications.createdAt,
    })
    .from(instructorNotifications)
    .where(
      and(
        eq(instructorNotifications.instructorId, instructorId),
        eq(instructorNotifications.type, 'call'),
        eq(instructorNotifications.accepted, false),
        isNull(instructorNotifications.readAt),
      ),
    )
    .orderBy(desc(instructorNotifications.createdAt));

  const pendingCallByStudent = new Map<string, { latestNotificationId: string; pendingCount: number }>();
  for (const row of pendingCallRows) {
    const found = pendingCallByStudent.get(row.studentId);
    if (!found) {
      pendingCallByStudent.set(row.studentId, { latestNotificationId: row.id, pendingCount: 1 });
    } else {
      found.pendingCount += 1;
    }
  }

  res.json({
    total: countRow?.total ?? 0,
    limit,
    offset,
    items: rows.map((r) => ({
      id: r.id,
      anonymousId: r.anonymousId,
      displayName: r.displayName,
      githubRepo: r.githubRepo,
      courseId: r.courseId,
      enrolledAt: r.enrolledAt,
      latestEwsScore: r.latestScore ?? null,
      scoreCalculatedAt: r.scoreCalculatedAt ?? null,
      pendingInstructorCallCount: pendingCallByStudent.get(r.id)?.pendingCount ?? 0,
      pendingNotificationId: pendingCallByStudent.get(r.id)?.latestNotificationId ?? null,
      riskLevel:
        r.latestScore == null ? 'unknown'
        : r.latestScore >= 80 ? 'critical'
        : r.latestScore >= 60 ? 'risk'
        : 'normal',
    })),
  });
});

// GET /instructor/ews — 위험 수강생 목록 (최근 30일 score >= 60, 허위 양성 제외)
router.get('/ews', async (req, res) => {
  const { institutionId } = req.user!;
  const cutoff = new Date(Date.now() - 30 * 86400_000);

  const rows = await db
    .select({
      scoreId: ewsRiskScores.id,
      studentId: ewsRiskScores.studentId,
      totalScore: ewsRiskScores.totalScore,
      componentScores: ewsRiskScores.componentScores,
      courseId: students.courseId,
      isFalsePositive: ewsRiskScores.isFalsePositive,
      instructorNote: ewsRiskScores.instructorNote,
      calculatedAt: ewsRiskScores.calculatedAt,
      displayName: students.displayName,
      anonymousId: students.anonymousId,
      githubRepo: students.githubRepo,
    })
    .from(ewsRiskScores)
    .innerJoin(students, eq(ewsRiskScores.studentId, students.id))
    .where(
      and(
        eq(students.institutionId, institutionId),
        gte(ewsRiskScores.totalScore, 60),
        gte(ewsRiskScores.calculatedAt, cutoff),
        isNull(ewsRiskScores.isFalsePositive),
        isNull(students.deletedAt),
      ),
    )
    .orderBy(desc(ewsRiskScores.totalScore));

  res.json(
    rows.map((r) => ({
      scoreId: r.scoreId,
      studentId: r.studentId,
      displayName: r.displayName,
      anonymousId: r.anonymousId,
      githubRepo: r.githubRepo,
      courseId: r.courseId,
      totalScore: r.totalScore,
      componentScores: r.componentScores,
      calculatedAt: r.calculatedAt,
      riskLevel: r.totalScore >= 80 ? 'critical' : 'risk',
    })),
  );
});

// GET /instructor/skills — 담당 스킬 파일 조회 (Phase 3)
router.get('/skills', (_req, res) => {
  res.status(501).json({ message: 'Phase 3에서 구현 예정' });
});

// ── 강사 알림 (호출 알림) ─────────────────────────────────────────────────────

/**
 * GET /instructor/notifications
 * 강사 알림 목록 (최근 50건, 미확인 우선)
 */
router.get('/notifications', async (req, res) => {
  const { sub: instructorId } = req.user!;
  const rows = await db
    .select({
      id: instructorNotifications.id,
      studentId: instructorNotifications.studentId,
      courseId: instructorNotifications.courseId,
      type: instructorNotifications.type,
      message: instructorNotifications.message,
      readAt: instructorNotifications.readAt,
      accepted: instructorNotifications.accepted,
      createdAt: instructorNotifications.createdAt,
      studentName: students.displayName,
      studentAnonymousId: students.anonymousId,
      courseName: courses.name,
    })
    .from(instructorNotifications)
    .leftJoin(students, eq(instructorNotifications.studentId, students.id))
    .leftJoin(courses, eq(instructorNotifications.courseId, courses.id))
    .where(eq(instructorNotifications.instructorId, instructorId))
    .orderBy(
      asc(instructorNotifications.readAt),   // 미확인(NULL) 먼저
      desc(instructorNotifications.createdAt),
    )
    .limit(50);

  const unreadCount = rows.filter((r) => !r.readAt).length;
  res.json({ notifications: rows, unreadCount });
});

/**
 * PATCH /instructor/notifications/:id/read
 * 알림 읽음 처리
 */
router.patch('/notifications/:id/read', async (req, res) => {
  const { sub: instructorId } = req.user!;
  const { id } = req.params;

  const notification = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.id, id),
      eq(instructorNotifications.instructorId, instructorId),
    ),
  });
  if (!notification) {
    res.status(404).json({ error: '알림을 찾을 수 없습니다.' });
    return;
  }

  await db
    .update(instructorNotifications)
    .set({ readAt: new Date() })
    .where(eq(instructorNotifications.id, id));

  res.json({ ok: true });
});

/**
 * PATCH /instructor/notifications/:id/accept
 * 강사가 호출을 수락하고 채팅방에 입장
 * → 소켓으로 수강생에게 강사 입장 알림 발송
 */
router.patch('/notifications/:id/accept', async (req, res) => {
  const { sub: instructorId } = req.user!;
  const { id } = req.params;

  const notification = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.id, id),
      eq(instructorNotifications.instructorId, instructorId),
    ),
  });
  if (!notification) {
    res.status(404).json({ error: '알림을 찾을 수 없습니다.' });
    return;
  }

  await db
    .update(instructorNotifications)
    .set({ readAt: new Date(), accepted: true })
    .where(eq(instructorNotifications.id, id));

  // 수강생에게 강사 입장 알림 push
  if (io) {
    io.to(`student:${notification.studentId}`).emit('instructor_joined', {
      notificationId: id,
      courseId: notification.courseId,
      instructorId,
    });
  }

  res.json({ ok: true, notificationId: id });
});

// ── 강사-수강생 1:1 채팅 ──────────────────────────────────────────────────────

/**
 * GET /instructor/chat/:notificationId/messages
 * 1:1 채팅 메시지 이력
 */
router.get('/chat/:notificationId/messages', async (req, res) => {
  const { sub: instructorId } = req.user!;
  const { notificationId } = req.params;

  // 본인 알림인지 확인
  const notification = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.id, notificationId),
      eq(instructorNotifications.instructorId, instructorId),
    ),
  });
  if (!notification) {
    res.status(404).json({ error: '해당 채팅을 찾을 수 없습니다.' });
    return;
  }

  const messages = await db
    .select()
    .from(instructorChatMessages)
    .where(
      and(
        eq(instructorChatMessages.notificationId, notificationId),
        isNull(instructorChatMessages.deletedAt),
      ),
    )
    .orderBy(asc(instructorChatMessages.createdAt));

  res.json({ messages });
});

const instructorChatSendSchema = z.object({
  content: z.string().min(1).max(2000),
});

/**
 * POST /instructor/chat/:notificationId/messages
 * 강사가 1:1 채팅 메시지를 전송합니다.
 */
router.post('/chat/:notificationId/messages', async (req, res) => {
  const { sub: instructorId } = req.user!;
  const { notificationId } = req.params;

  const parsed = instructorChatSendSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '메시지 형식이 올바르지 않습니다.' });
    return;
  }

  const notification = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.id, notificationId),
      eq(instructorNotifications.instructorId, instructorId),
    ),
  });
  if (!notification) {
    res.status(404).json({ error: '해당 채팅을 찾을 수 없습니다.' });
    return;
  }

  if (!notification.accepted) {
    res.status(409).json({ error: '먼저 호출 요청을 수락해 주세요.' });
    return;
  }

  const [message] = await db
    .insert(instructorChatMessages)
    .values({
      notificationId,
      instructorId,
      studentId: notification.studentId,
      courseId: notification.courseId,
      senderRole: 'instructor',
      content: parsed.data.content,
    })
    .returning();

  if (io && message) {
    io.to(`student:${notification.studentId}`).emit('instructor_chat_message', {
      notificationId,
      from: 'instructor',
      message,
    });
  }

  res.status(201).json({ message });
});

export default router;
