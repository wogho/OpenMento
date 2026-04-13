import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import {
  eq, and, desc, asc, isNull,
  db,
  conversationMessages, agents, instructorSkills, studentCourses, students, courses, adminUsers,
  assignments, studentAgentPreferences,
  instructorNotifications, instructorChatMessages,
  inArray,
} from '@openmento/db';
import { tutorChat, getChatHistory } from '../services/tutor-agent.js';
import { io } from '../socket/chat.handler.js';

const router: ReturnType<typeof Router> = Router();

// 모든 /student/* 라우트에 인증 + 역할 검증 적용
// student / teacher / admin 모두 접근 가능 (강사가 수강생 포털 조회 가능)
router.use(authenticate);
router.use(requireRole('student', 'teacher', 'admin'));

const STUDENT_MAX_ACTIVE_AGENTS = Math.max(1, Number(process.env.STUDENT_AGENT_MAX_ACTIVE ?? 2));

async function ensureStudentEnrollment(studentId: string, courseId: string) {
  return db.query.studentCourses.findFirst({
    where: and(
      eq(studentCourses.studentId, studentId),
      eq(studentCourses.courseId, courseId),
      isNull(studentCourses.deletedAt),
    ),
  });
}

async function getCourseAgentOptions(studentId: string, courseId: string, institutionId: string) {
  const rows = await db
    .select({
      skillAgentId: instructorSkills.agentId,
      agentName: agents.name,
      agentRole: agents.role,
      agentIsActive: agents.isActive,
      agentRuntimeConfig: agents.runtimeConfig,
      prefIsActive: studentAgentPreferences.isActive,
      prefHeartbeatDisabled: studentAgentPreferences.heartbeatDisabled,
    })
    .from(instructorSkills)
    .leftJoin(agents, eq(instructorSkills.agentId, agents.id))
    .leftJoin(
      studentAgentPreferences,
      and(
        eq(studentAgentPreferences.studentId, studentId),
        eq(studentAgentPreferences.courseId, courseId),
        eq(studentAgentPreferences.agentId, instructorSkills.agentId),
      ),
    )
    .where(
      and(
        eq(instructorSkills.courseId, courseId),
        eq(instructorSkills.institutionId, institutionId),
        eq(instructorSkills.isActive, true),
        isNull(instructorSkills.deletedAt),
      ),
    )
    .orderBy(asc(instructorSkills.createdAt));

  const uniqueByAgentId = new Map<string, {
    id: string;
    name: string;
    role: string;
    isOnline: boolean;
    isActiveForStudent: boolean;
    heartbeatDisabled: boolean;
    heartbeatEnabled: boolean;
  }>();

  for (const row of rows) {
    if (!row.skillAgentId) continue;
    if (uniqueByAgentId.has(row.skillAgentId)) continue;

    const rc = row.agentRuntimeConfig as { heartbeat?: { enabled?: boolean; proactive?: boolean } } | null;
    uniqueByAgentId.set(row.skillAgentId, {
      id: row.skillAgentId,
      name: row.agentName ?? 'AI 튜터',
      role: row.agentRole ?? 'ai_tutor',
      isOnline: row.agentIsActive ?? true,
      isActiveForStudent: row.prefIsActive !== false,
      heartbeatDisabled: row.prefHeartbeatDisabled ?? true,
      // heartbeat.enabled = true 이면 수강생 메뉴에 서브토글 표시 (proactive 여부와 무관)
      heartbeatEnabled: Boolean(rc?.heartbeat?.enabled),
    });
  }

  const options = Array.from(uniqueByAgentId.values());
  const activeCount = options.filter((opt) => opt.isActiveForStudent && opt.isOnline).length;

  return {
    agents: options,
    activeCount,
    maxActiveAgents: Math.min(STUDENT_MAX_ACTIVE_AGENTS, Math.max(1, options.length)),
  };
}

// GET /student/me — 수강생 본인 정보 조회
router.get('/me', (req, res) => {
  const { sub, institutionId } = req.user!;
  res.json({ userId: sub, institutionId });
});

// GET /student/courses — 수강생 본인의 수강 과목 목록 반환 (M2M)
router.get('/courses', async (req, res) => {
  const { sub: studentId, institutionId } = req.user!;
  try {
    // M2M: student_courses → courses join
    const rows = await db
      .select({ course: courses })
      .from(studentCourses)
      .innerJoin(courses, eq(studentCourses.courseId, courses.id))
      .where(
        and(
          eq(studentCourses.studentId, studentId),
          isNull(studentCourses.deletedAt),
          isNull(courses.deletedAt),
        )
      );

    if (rows.length === 0) {
      res.json({ courses: [] });
      return;
    }

    const result = await Promise.all(rows.map(async ({ course: c }) => {
      let instructorName: string | null = null;
      if (c.instructorId) {
        const instructor = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.id, c.instructorId),
        });
        instructorName = instructor?.name ?? null;
      }

      const menu = await getCourseAgentOptions(studentId, c.id, institutionId);
      const primaryAgent = menu.agents.find((a) => a.isActiveForStudent && a.isOnline) ?? null;

      return {
        id: c.id,
        name: c.name,
        subject: c.subject,
        instructorName,
        agentId: primaryAgent?.id ?? null,
        availableAgents: menu.agents,
        activeAgentCount: menu.activeCount,
        maxActiveAgents: menu.maxActiveAgents,
        startDate: c.startDate,
        endDate: c.endDate,
        isActive: c.isActive,
      };
    }));

    res.json({ courses: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '과목 조회 실패' });
  }
});

const courseParamsSchema = z.object({
  courseId: z.string().uuid(),
});

const courseAgentToggleParamsSchema = z.object({
  courseId: z.string().uuid(),
  agentId: z.string().uuid(),
});

const agentToggleBodySchema = z.object({
  isActive: z.boolean(),
});

/**
 * GET /student/courses/:courseId/menu
 * 수강생 채팅 메뉴에 필요한 정보(강사 호출, 과제, 에이전트 토글, 임계치)를 반환합니다.
 */
router.get('/courses/:courseId/menu', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const parsed = courseParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 courseId입니다.' });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;
  const { courseId } = parsed.data;

  const enrollment = await ensureStudentEnrollment(studentId, courseId);
  if (!enrollment) {
    res.status(403).json({ error: '해당 과목 수강 권한이 없습니다.' });
    return;
  }

  const course = await db.query.courses.findFirst({
    where: and(eq(courses.id, courseId), isNull(courses.deletedAt)),
  });
  if (!course) {
    res.status(404).json({ error: '과목을 찾을 수 없습니다.' });
    return;
  }

  const instructor = course.instructorId
    ? await db.query.adminUsers.findFirst({ where: eq(adminUsers.id, course.instructorId) })
    : null;

  const menu = await getCourseAgentOptions(studentId, courseId, institutionId);

  const assignmentRows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      dueAt: assignments.dueAt,
      createdAt: assignments.createdAt,
      isPublished: assignments.isPublished,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.courseId, courseId),
        eq(assignments.isPublished, true),
        isNull(assignments.deletedAt),
      ),
    )
    .orderBy(desc(assignments.createdAt))
    .limit(20);

  const latestCall = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.studentId, studentId),
      eq(instructorNotifications.courseId, courseId),
      eq(instructorNotifications.type, 'call'),
    ),
    orderBy: (t, { desc: d }) => [d(t.createdAt)],
  });

  res.json({
    course: {
      id: course.id,
      name: course.name,
      subject: course.subject,
    },
    instructor: {
      id: course.instructorId,
      name: instructor?.name ?? null,
    },
    agents: menu.agents,
    limits: {
      activeAgentCount: menu.activeCount,
      maxActiveAgents: menu.maxActiveAgents,
    },
    assignments: assignmentRows,
    latestCall: latestCall
      ? {
          id: latestCall.id,
          accepted: latestCall.accepted,
          readAt: latestCall.readAt,
          createdAt: latestCall.createdAt,
        }
      : null,
  });
});

/**
 * PATCH /student/courses/:courseId/agents/:agentId/toggle
 * 과목 내 에이전트의 개인 활성/비활성 설정을 갱신합니다.
 */
router.patch('/courses/:courseId/agents/:agentId/toggle', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const parsedParams = courseAgentToggleParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: '파라미터 형식이 올바르지 않습니다.' });
    return;
  }

  const parsedBody = agentToggleBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;
  const { courseId, agentId } = parsedParams.data;
  const { isActive } = parsedBody.data;

  const enrollment = await ensureStudentEnrollment(studentId, courseId);
  if (!enrollment) {
    res.status(403).json({ error: '해당 과목 수강 권한이 없습니다.' });
    return;
  }

  const linkedSkill = await db.query.instructorSkills.findFirst({
    where: and(
      eq(instructorSkills.courseId, courseId),
      eq(instructorSkills.institutionId, institutionId),
      eq(instructorSkills.agentId, agentId),
      eq(instructorSkills.isActive, true),
      isNull(instructorSkills.deletedAt),
    ),
  });
  if (!linkedSkill) {
    res.status(404).json({ error: '해당 과목에 연결된 에이전트를 찾을 수 없습니다.' });
    return;
  }

  const menu = await getCourseAgentOptions(studentId, courseId, institutionId);
  const current = menu.agents.find((a) => a.id === agentId);
  if (!current) {
    res.status(404).json({ error: '에이전트 설정을 찾을 수 없습니다.' });
    return;
  }

  if (isActive && !current.isActiveForStudent && menu.activeCount >= menu.maxActiveAgents) {
    res.status(409).json({
      error: `활성화 가능한 에이전트 임계치(${menu.maxActiveAgents})를 초과할 수 없습니다.`,
    });
    return;
  }

  await db
    .insert(studentAgentPreferences)
    .values({
      studentId,
      courseId,
      agentId,
      isActive,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        studentAgentPreferences.studentId,
        studentAgentPreferences.courseId,
        studentAgentPreferences.agentId,
      ],
      set: {
        isActive,
        updatedAt: new Date(),
      },
    });

  const updated = await getCourseAgentOptions(studentId, courseId, institutionId);
  res.json({
    ok: true,
    agents: updated.agents,
    limits: {
      activeAgentCount: updated.activeCount,
      maxActiveAgents: updated.maxActiveAgents,
    },
  });
});

/**
 * PATCH /student/courses/:courseId/agents/:agentId/heartbeat
 * 수강생 개별 Heartbeat 활성/비활성 설정을 갱신합니다.
 * Body: { heartbeatDisabled: boolean }
 */
router.patch('/courses/:courseId/agents/:agentId/heartbeat', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const parsedParams = courseAgentToggleParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: '파라미터 형식이 올바르지 않습니다.' });
    return;
  }

  const bodySchema = z.object({ heartbeatDisabled: z.boolean() });
  const parsedBody = bodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다. heartbeatDisabled(boolean) 필드가 필요합니다.' });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;
  const { courseId, agentId } = parsedParams.data;
  const { heartbeatDisabled } = parsedBody.data;

  const enrollment = await ensureStudentEnrollment(studentId, courseId);
  if (!enrollment) {
    res.status(403).json({ error: '해당 과목 수강 권한이 없습니다.' });
    return;
  }

  void institutionId; // used for enrollment check context

  await db
    .insert(studentAgentPreferences)
    .values({
      studentId,
      courseId,
      agentId,
      isActive: true,
      heartbeatDisabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        studentAgentPreferences.studentId,
        studentAgentPreferences.courseId,
        studentAgentPreferences.agentId,
      ],
      set: {
        heartbeatDisabled,
        updatedAt: new Date(),
      },
    });

  res.json({ ok: true, agentId, heartbeatDisabled });
});

/**
 * POST /student/courses/:courseId/instructor-call
 * 수강생이 강사 호출을 요청합니다.
 */
router.post('/courses/:courseId/instructor-call', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const parsed = courseParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 courseId입니다.' });
    return;
  }

  const { sub: studentId } = req.user!;
  const { courseId } = parsed.data;

  const enrollment = await ensureStudentEnrollment(studentId, courseId);
  if (!enrollment) {
    res.status(403).json({ error: '해당 과목 수강 권한이 없습니다.' });
    return;
  }

  const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
  if (!course || !course.instructorId) {
    res.status(400).json({ error: '강사 정보가 없는 과목입니다.' });
    return;
  }

  const student = await db.query.students.findFirst({ where: eq(students.id, studentId) });
  const studentName = student?.displayName ?? student?.anonymousId ?? '수강생';

  const [created] = await db
    .insert(instructorNotifications)
    .values({
      instructorId: course.instructorId,
      studentId,
      courseId,
      type: 'call',
      message: `${studentName}님이 채팅을 요청했습니다.`,
    })
    .returning();

  if (io && created) {
    io.to(`user:${course.instructorId}`).emit('instructor_call_requested', {
      notificationId: created.id,
      studentId,
      studentName,
      courseId,
      courseName: course.name,
      message: created.message,
      createdAt: created.createdAt,
    });
  }

  res.status(201).json({
    notificationId: created?.id,
    message: '강사 호출 요청을 전송했습니다.',
  });
});

const instructorChatParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

const instructorChatSendSchema = z.object({
  content: z.string().min(1).max(2000),
});

/**
 * GET /student/instructor-chat/:notificationId/messages
 * 수강생 1:1 채팅 메시지 이력을 조회합니다.
 */
router.get('/instructor-chat/:notificationId/messages', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const parsed = instructorChatParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: '유효하지 않은 notificationId입니다.' });
    return;
  }

  const { sub: studentId } = req.user!;
  const { notificationId } = parsed.data;

  const notification = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.id, notificationId),
      eq(instructorNotifications.studentId, studentId),
    ),
  });
  if (!notification) {
    res.status(404).json({ error: '해당 채팅 요청을 찾을 수 없습니다.' });
    return;
  }

  if (!notification.accepted) {
    res.json({ accepted: false, messages: [] });
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

  res.json({ accepted: true, messages });
});

/**
 * POST /student/instructor-chat/:notificationId/messages
 * 수강생이 강사 1:1 채팅 메시지를 보냅니다.
 */
router.post('/instructor-chat/:notificationId/messages', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const parsedParams = instructorChatParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: '유효하지 않은 notificationId입니다.' });
    return;
  }
  const parsedBody = instructorChatSendSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: '메시지 내용이 올바르지 않습니다.' });
    return;
  }

  const { sub: studentId } = req.user!;
  const { notificationId } = parsedParams.data;
  const { content } = parsedBody.data;

  const notification = await db.query.instructorNotifications.findFirst({
    where: and(
      eq(instructorNotifications.id, notificationId),
      eq(instructorNotifications.studentId, studentId),
    ),
  });
  if (!notification) {
    res.status(404).json({ error: '해당 채팅 요청을 찾을 수 없습니다.' });
    return;
  }

  if (!notification.accepted) {
    res.status(409).json({ error: '강사가 아직 채팅 요청을 수락하지 않았습니다.' });
    return;
  }

  const [message] = await db
    .insert(instructorChatMessages)
    .values({
      notificationId,
      instructorId: notification.instructorId,
      studentId,
      courseId: notification.courseId,
      senderRole: 'student',
      content,
    })
    .returning();

  if (io && message) {
    io.to(`user:${notification.instructorId}`).emit('instructor_chat_message', {
      notificationId,
      from: 'student',
      message,
    });
  }

  res.status(201).json({ message });
});

/**
 * GET /student/instructor-calls
 * 수강생의 강사 호출 요청 목록을 조회합니다.
 */
router.get('/instructor-calls', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '학생 계정만 사용할 수 있습니다.' });
    return;
  }

  const { sub: studentId } = req.user!;
  const courseId = (req.query['courseId'] as string | undefined) ?? null;

  const rows = await db
    .select({
      id: instructorNotifications.id,
      courseId: instructorNotifications.courseId,
      instructorId: instructorNotifications.instructorId,
      accepted: instructorNotifications.accepted,
      readAt: instructorNotifications.readAt,
      createdAt: instructorNotifications.createdAt,
      message: instructorNotifications.message,
      instructorName: adminUsers.name,
      courseName: courses.name,
    })
    .from(instructorNotifications)
    .leftJoin(adminUsers, eq(instructorNotifications.instructorId, adminUsers.id))
    .leftJoin(courses, eq(instructorNotifications.courseId, courses.id))
    .where(
      and(
        eq(instructorNotifications.studentId, studentId),
        ...(courseId ? [eq(instructorNotifications.courseId, courseId)] : []),
      ),
    )
    .orderBy(desc(instructorNotifications.createdAt))
    .limit(30);

  res.json({ calls: rows });
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
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '수강생 채팅은 학생 계정으로만 사용할 수 있습니다. /auth/student-login으로 로그인해 주세요.' });
    return;
  }

  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: '요청 형식이 올바르지 않습니다.',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;
  const { question, sessionId, courseId } = parsed.data;
  let { agentId } = parsed.data;

  // courseId가 있으면 수강생별 활성 에이전트 집합으로 강제합니다.
  if (courseId) {
    const menu = await getCourseAgentOptions(studentId, courseId, institutionId);
    const allowedAgentIds = menu.agents.filter((a) => a.isActiveForStudent && a.isOnline).map((a) => a.id);

    if (allowedAgentIds.length === 0) {
      res.status(409).json({ error: '활성화된 에이전트가 없습니다. 채팅 메뉴에서 에이전트를 먼저 활성화해 주세요.' });
      return;
    }
    if (!allowedAgentIds.includes(agentId)) {
      agentId = allowedAgentIds[0]!;
    }
  }

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
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '수강생 채팅 이력은 학생 계정으로만 조회할 수 있습니다.' });
    return;
  }

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


// ── 수강생 채팅 목록 (Phase 10: Chat List View) ───────────────────────────────────

/**
 * GET /student/sessions
 * 수강생의 과거 채팅 세션 목록을 반환합니다.
 * 에이전트 정보 및 최근 대화 내용 포함.
 */
router.get('/sessions', async (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ error: '수강생 채팅 목록은 학생 계정으로만 조회할 수 있습니다.' });
    return;
  }

  const { sub: studentId, institutionId } = req.user!;

  try {
    const rows = await db.query.conversationMessages.findMany({
      where: eq(conversationMessages.studentId, studentId),
      orderBy: [desc(conversationMessages.createdAt)],
    });

    // 세션별로 최근 메시지로 그룹화
    const sessionMap = new Map<string, any>();
    for (const row of rows) {
      if (!row.sessionId) continue;
      if (!sessionMap.has(row.sessionId)) {
        sessionMap.set(row.sessionId, {
          sessionId: row.sessionId,
          agentId: row.agentId,
          courseId: row.courseId,
          lastMessage: row.content,
          updatedAt: row.createdAt,
        });
      }
    }

    const sessions = Array.from(sessionMap.values());
    
    // 에이전트 이름 등 추가 정보
    const agentsData = await db.select().from(agents).where(eq(agents.institutionId, institutionId));
    const agentMap = new Map(agentsData.map(a => [a.id, a.name]));

    // 과목 + 강사 정보 조회
    const courseIds = [...new Set(sessions.map(s => s.courseId).filter(Boolean))] as string[];
    const courseMap = new Map<string, { name: string; instructorName: string | null }>();
    if (courseIds.length > 0) {
      const courseRows = await db.select({
        id: courses.id,
        name: courses.name,
        instructorId: courses.instructorId,
      }).from(courses).where(inArray(courses.id, courseIds));

      const instructorIds = [...new Set(courseRows.map(c => c.instructorId).filter(Boolean))] as string[];
      const instructorMap = new Map<string, string>();
      if (instructorIds.length > 0) {
        const instructorRows = await db.select({ id: adminUsers.id, name: adminUsers.name })
          .from(adminUsers).where(inArray(adminUsers.id, instructorIds));
        for (const r of instructorRows) instructorMap.set(r.id, r.name);
      }

      for (const c of courseRows) {
        courseMap.set(c.id, {
          name: c.name,
          instructorName: c.instructorId ? (instructorMap.get(c.instructorId) ?? null) : null,
        });
      }
    }

    const enrichedSessions = sessions.map(s => ({
      ...s,
      agentName: s.agentId ? (agentMap.get(s.agentId) || 'AI 튜터') : 'AI 튜터',
      courseName: s.courseId ? (courseMap.get(s.courseId)?.name ?? null) : null,
      instructorName: s.courseId ? (courseMap.get(s.courseId)?.instructorName ?? null) : null,
      title: (() => {
        const info = s.courseId ? courseMap.get(s.courseId) : null;
        if (info) return `${info.name}${info.instructorName ? ` - ${info.instructorName}` : ''}`;
        return 'AI 튜터링 세션';
      })(),
    }));

    res.json({ sessions: enrichedSessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '목록 조회 실패' });
  }
});
export default router;
