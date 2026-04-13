/**
 * lms-webhook.ts — LMS Push Webhook 수신 라우터
 *
 * 외부 LMS(Moodle, Canvas, 자체 개발 LMS 등)가 이벤트 발생 시
 * OpenMento에 데이터를 직접 Push할 수 있는 수신 전용 엔드포인트입니다.
 *
 * ── 설계 원칙 ────────────────────────────────────────────────────────────────
 *  - OpenMento → LMS: Read-only Pull (attendance.connector, lms.connector)
 *  - LMS → OpenMento: Push (이 파일)
 *
 * ── 엔드포인트 ──────────────────────────────────────────────────────────────
 *  POST /lms-webhook/attendance
 *    LMS에서 출결 이벤트 발생 시 호출. attendance_logs에 저장 후 EWS 즉시 갱신.
 *
 *  POST /lms-webhook/grades
 *    LMS에서 과제/성적 이벤트 발생 시 호출. assignment_submissions에 upsert.
 *
 *  GET  /lms-webhook/status
 *    웹훅 수신 상태 확인용 헬스체크 (LMS 측 설정 검증에 사용).
 *
 * ── 보안 ────────────────────────────────────────────────────────────────────
 *  HMAC-SHA256 서명 검증 (LMS_WEBHOOK_SECRET 환경변수 필요).
 *  서명 미설정 시 개발 환경에서만 통과 (NODE_ENV !== 'production').
 *  기관 식별은 X-Institution-Id 헤더 또는 institutionId 바디 필드로 수행.
 *  Replay Attack 방지: X-Timestamp 헤더 5분 유효 창 검증.
 *
 * ── 이벤트 타입 ─────────────────────────────────────────────────────────────
 *  attendance: { studentId, courseId, attendanceDate, status }
 *  grade:      { studentId, courseId, assignmentId, assignmentTitle, score, maxScore, submittedAt }
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  db,
  attendanceLogs,
  students,
  eq,
  and,
  isNull,
  sql,
} from '@openmento/db';
import { computeAndSaveEwsScore } from '../services/ews-monitor.js';
import { webhookLimiter } from '../middleware/rateLimiter.js';
import { logger } from '../utils/logger.js';

const router: RouterType = Router();

// ── HMAC-SHA256 서명 검증 ─────────────────────────────────────────────────────

/**
 * LMS 웹훅 서명을 검증합니다.
 * LMS_WEBHOOK_SECRET 환경변수가 없으면 개발 환경에서만 통과합니다.
 */
function verifyLmsSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
): { ok: boolean; reason?: string } {
  const secret = process.env.LMS_WEBHOOK_SECRET?.trim();

  // 서명 미설정 → 개발 환경에만 허용
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'LMS_WEBHOOK_SECRET 환경변수가 설정되지 않았습니다.' };
    }
    logger.warn('[lms-webhook] LMS_WEBHOOK_SECRET 미설정 — 개발 환경에서만 허용합니다.');
    return { ok: true };
  }

  // Replay Attack 방지: 타임스탬프 5분 유효 창
  if (timestampHeader) {
    const ts = parseInt(timestampHeader, 10);
    if (!isNaN(ts)) {
      const diffMs = Math.abs(Date.now() - ts * 1000);
      if (diffMs > 5 * 60 * 1000) {
        return { ok: false, reason: '웹훅 타임스탬프가 5분을 초과했습니다. Replay Attack 가능성.' };
      }
    }
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'X-Signature-256 헤더가 없거나 형식이 올바르지 않습니다.' };
  }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(rawBody).digest('hex'),
  );
  const received = Buffer.from(signatureHeader.slice(7));
  if (expected.length !== received.length) {
    return { ok: false, reason: '서명 검증 실패' };
  }
  if (!timingSafeEqual(expected, received)) {
    return { ok: false, reason: '서명 검증 실패' };
  }
  return { ok: true };
}

// ── Zod 스키마 ────────────────────────────────────────────────────────────────

const AttendanceEventSchema = z.object({
  institutionId: z.string().uuid('institutionId는 UUID여야 합니다.'),
  events: z.array(z.object({
    studentId: z.string().uuid(),
    courseId: z.string().uuid(),
    attendanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다.'),
    status: z.enum(['present', 'absent', 'late', 'excused']),
  })).min(1).max(500, '이벤트는 최대 500개까지 처리합니다.'),
});

const GradeEventSchema = z.object({
  institutionId: z.string().uuid('institutionId는 UUID여야 합니다.'),
  events: z.array(z.object({
    studentId: z.string().uuid(),
    courseId: z.string().uuid(),
    assignmentId: z.string().min(1),
    assignmentTitle: z.string().optional(),
    score: z.number().min(0),
    maxScore: z.number().min(1),
    submittedAt: z.string().datetime({ message: 'ISO 8601 형식이어야 합니다.' }),
    status: z.enum(['submitted', 'late', 'missing', 'graded']).optional().default('submitted'),
  })).min(1).max(500),
});

// ── 공통 헬퍼: 기관 내 수강생 UUID 집합 검증 ────────────────────────────────────

async function getInstitutionStudentIds(institutionId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.institutionId, institutionId), isNull(students.deletedAt)));
  return new Set(rows.map((r) => r.id));
}

// ── POST /lms-webhook/attendance ─────────────────────────────────────────────

/**
 * LMS 출결 이벤트 수신
 *
 * LMS는 강의 시작/종료 시 또는 관리자 입력 시 이 엔드포인트를 호출합니다.
 * 이벤트는 attendance_logs 테이블에 upsert되며, 영향받는 수강생의 EWS 점수가 즉시 갱신됩니다.
 *
 * 요청 형식:
 *   Content-Type: application/json
 *   X-Signature-256: sha256=<HMAC>
 *   X-Timestamp: <Unix epoch seconds>
 *
 * 요청 바디:
 *   {
 *     institutionId: string (UUID),
 *     events: [{ studentId, courseId, attendanceDate, status }, ...]
 *   }
 */
router.post('/attendance', webhookLimiter, async (req, res) => {
  const rawBody: Buffer = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));

  const { ok, reason } = verifyLmsSignature(
    rawBody,
    req.headers['x-signature-256'] as string | undefined,
    req.headers['x-timestamp'] as string | undefined,
  );
  if (!ok) {
    logger.warn({ reason }, '[lms-webhook] 출결 서명 검증 실패');
    res.status(401).json({ error: reason ?? '서명 검증 실패' });
    return;
  }

  const parsed = AttendanceEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId, events } = parsed.data;

  // 기관 소속 수강생 목록 검증 (IDOR / 월경 방지)
  const validStudentIds = await getInstitutionStudentIds(institutionId);
  const filteredEvents = events.filter((ev) => validStudentIds.has(ev.studentId));

  if (filteredEvents.length === 0) {
    res.status(207).json({ message: '기관에 소속된 수강생이 없어 처리된 이벤트가 없습니다.', processed: 0 });
    return;
  }

  // attendance_logs upsert (INSERT … ON CONFLICT DO UPDATE)
  // 같은 수강생 + 과목 + 날짜에 대해 LMS가 두 번 보내면 최신 상태를 덮어씁니다.
  const values = filteredEvents.map((ev) => ({
    studentId: ev.studentId,
    courseId: ev.courseId,
    attendanceDate: ev.attendanceDate,
    status: ev.status,
    sourceSystem: 'lms',
    createdAt: new Date(),
  }));

  await db
    .insert(attendanceLogs)
    .values(values)
    .onConflictDoUpdate({
      target: [attendanceLogs.studentId, attendanceLogs.courseId, attendanceLogs.attendanceDate],
      set: {
        status: sql`excluded.status`,
        sourceSystem: sql`excluded.source_system`,
      },
    });

  // EWS 점수 즉시 갱신 (영향받는 수강생-과목 쌍만)
  const ewsTargets = new Map<string, { studentId: string; courseId: string }>();
  for (const ev of filteredEvents) {
    ewsTargets.set(`${ev.studentId}:${ev.courseId}`, { studentId: ev.studentId, courseId: ev.courseId });
  }

  const ewsResults = await Promise.allSettled(
    [...ewsTargets.values()].map((t) => computeAndSaveEwsScore(t.studentId, t.courseId)),
  );

  const ewsErrors = ewsResults.filter((r) => r.status === 'rejected').length;

  logger.info(
    `[lms-webhook] 출결 이벤트 처리 완료: processed=${filteredEvents.length}, ewsUpdated=${ewsTargets.size - ewsErrors}, ewsErrors=${ewsErrors}`,
  );

  res.status(202).json({
    message: '출결 이벤트가 처리되었습니다.',
    processed: filteredEvents.length,
    skipped: events.length - filteredEvents.length,
    ewsUpdated: ewsTargets.size - ewsErrors,
  });
});

// ── POST /lms-webhook/grades ──────────────────────────────────────────────────

/**
 * LMS 과제/성적 이벤트 수신
 *
 * 과제 제출 또는 채점 완료 시 LMS가 호출합니다.
 * assignment_submissions 테이블에 upsert됩니다.
 * 이후 EWS 점수 갱신이 백그라운드로 실행됩니다.
 */
router.post('/grades', webhookLimiter, async (req, res) => {
  const rawBody: Buffer = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));

  const { ok, reason } = verifyLmsSignature(
    rawBody,
    req.headers['x-signature-256'] as string | undefined,
    req.headers['x-timestamp'] as string | undefined,
  );
  if (!ok) {
    logger.warn({ reason }, '[lms-webhook] 성적 서명 검증 실패');
    res.status(401).json({ error: reason ?? '서명 검증 실패' });
    return;
  }

  const parsed = GradeEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '요청 형식이 올바르지 않습니다.', details: parsed.error.flatten() });
    return;
  }

  const { institutionId, events } = parsed.data;

  const validStudentIds = await getInstitutionStudentIds(institutionId);
  const filteredEvents = events.filter((ev) => validStudentIds.has(ev.studentId));

  if (filteredEvents.length === 0) {
    res.status(207).json({ message: '기관에 소속된 수강생이 없어 처리된 이벤트가 없습니다.', processed: 0 });
    return;
  }

  // assignment_submissions upsert
  // assignment_id + student_id 를 고유 키로 사용합니다.
  const submissionValues = filteredEvents.map((ev) => ({
    studentId: ev.studentId,
    courseId: ev.courseId,
    assignmentId: ev.assignmentId,
    assignmentTitle: ev.assignmentTitle ?? ev.assignmentId,
    score: ev.score,
    maxScore: ev.maxScore,
    status: ev.status,
    submittedAt: new Date(ev.submittedAt),
    sourceSystem: 'lms',
    createdAt: new Date(),
  }));

  // Raw SQL upsert (Drizzle는 multi-column unique에 대한 onConflictDoUpdate 지원)
  for (const sv of submissionValues) {
    await db.execute(sql`
      INSERT INTO assignment_submissions
        (student_id, course_id, assignment_id, assignment_title, score, max_score, status, submitted_at, source_system, created_at)
      VALUES
        (${sv.studentId}::uuid, ${sv.courseId}::uuid, ${sv.assignmentId}, ${sv.assignmentTitle},
         ${sv.score}, ${sv.maxScore}, ${sv.status}, ${sv.submittedAt.toISOString()}::timestamptz,
         ${sv.sourceSystem}, ${sv.createdAt.toISOString()}::timestamptz)
      ON CONFLICT (student_id, assignment_id)
      DO UPDATE SET
        score = EXCLUDED.score,
        max_score = EXCLUDED.max_score,
        status = EXCLUDED.status,
        submitted_at = EXCLUDED.submitted_at,
        source_system = EXCLUDED.source_system
    `);
  }

  // EWS 점수 비동기 갱신 (응답 차단 없음)
  const ewsTargets = new Map<string, { studentId: string; courseId: string }>();
  for (const ev of filteredEvents) {
    ewsTargets.set(`${ev.studentId}:${ev.courseId}`, { studentId: ev.studentId, courseId: ev.courseId });
  }
  Promise.allSettled(
    [...ewsTargets.values()].map((t) => computeAndSaveEwsScore(t.studentId, t.courseId)),
  ).catch((err) => logger.error({ err }, '[lms-webhook] EWS 비동기 갱신 실패'));

  logger.info(`[lms-webhook] 성적 이벤트 처리 완료: processed=${filteredEvents.length}`);

  res.status(202).json({
    message: '성적 이벤트가 처리되었습니다.',
    processed: filteredEvents.length,
    skipped: events.length - filteredEvents.length,
  });
});

// ── GET /lms-webhook/status ───────────────────────────────────────────────────

/**
 * LMS 관리자가 웹훅 URL을 등록할 때 수신 확인용으로 호출합니다.
 * 서명 검증 없이 200 OK를 반환합니다.
 */
router.get('/status', (_req, res) => {
  res.json({
    ok: true,
    service: 'openmento-lms-webhook',
    version: process.env.npm_package_version ?? '0.1.0',
    endpoints: [
      { method: 'POST', path: '/lms-webhook/attendance', description: '출결 이벤트 수신' },
      { method: 'POST', path: '/lms-webhook/grades', description: '과제/성적 이벤트 수신' },
    ],
    signatureRequired: !!process.env.LMS_WEBHOOK_SECRET,
    timestamp: new Date().toISOString(),
  });
});

export default router;
