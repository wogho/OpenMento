/**
 * ews-monitor.ts — EWS(Early Warning System) 위험 점수 산출 서비스
 *
 * plan.md Phase 2-2 작업 항목 구현.
 *
 * ── Gemini 제언 개선 반영 (2가지) ──────────────────────────────────────────
 *
 * 1. N+1 쿼리 제거 → Batch Query + Bulk Insert
 *    기존: 수강생 N명 × 쿼리 5개 = N×5 쿼리
 *    개선: 4개 Batch IN 쿼리 + 1개 Bulk INSERT (수강생 수와 무관하게 쿼리 5개)
 *         - 출결: IN 배치 + GROUP BY (단일 쿼리)
 *         - 과제: ROW_NUMBER() OVER (PARTITION BY ...) 윈도우 함수 (단일 쿼리)
 *         - 상담: IN 배치 + GROUP BY (단일 쿼리)
 *         - AI튜터: FILTER 집계 2기간 동시 산출 (단일 쿼리)
 *         - 결과: Bulk INSERT scores[]
 *
 * 2. KST(Asia/Seoul) 날짜 경계 정확화
 *    기존: toISOString().slice(0,10) → UTC 기준 → KST 새벽 0~9시 오작동
 *    개선: Intl.DateTimeFormat + Date.UTC 순수 오프셋 산술
 *         → KST 자정(00:00 KST)을 UTC 밀리초로 정확 변환
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 위험 점수 계산 (총 100점 — 적응형 가중치):
 *  ┌────────────────────────────┬──────┬──────┬──────────────────────────────────────────┐
 *  │ 요소                       │ 기본 │ LMS미│ 임계 조건                                │
 *  │                            │ 가중 │ 연동시│                                         │
 *  ├────────────────────────────┼──────┼──────┼──────────────────────────────────────────┤
 *  │ AI 상호작용 복합 지표       │  40% │  60% │ 14일 활동일 ≤ 2일, 이번 주 급감          │
 *  │ 과제 미제출                 │  25% │  25% │ 최근 3개 중 2개 이상 missing/late        │
 *  │ 강사 상담 이력              │  15% │  15% │ 최근 2주 내 부정적 상담 기록             │
 *  │ 출석률 (LMS 연동 시만 적용) │  20% │   0% │ 최근 5일 중 2일 이상 결석                │
 *  └────────────────────────────┴──────┴──────┴──────────────────────────────────────────┘
 *
 *  ※ LMS 미연동(출결 데이터 없음) 시 출석률 가중치 20점을 AI 상호작용에 재배분 (40→60)
 *
 * 점수 해석:
 *  - 0~59:  일반 (Normal)
 *  - 60~74: 주의 (Warning) → 담당 강사 Slack 알림 (Phase 2-4)
 *  - 75~89: 위험 (High Risk) → 강사 + 원장 Slack + 멘탈케어 에이전트
 *  - 90~100:긴급 (Critical) → 즉시 전화 상담 예약 자동 생성
 */

import { and, eq, isNull, inArray, sql } from '@openmento/db';
import {
  db,
  students,
  attendanceLogs,
  counselingNotes,
  ewsRiskScores,
} from '@openmento/db';
import type { Agent } from '@openmento/db';
import { getEwsThresholds } from './ews-thresholds.js';
import { logger } from '../utils/logger.js';

// ── 상수 ────────────────────────────────────────────────────────────────────

/**
 * EWS 가중치 상수 (LMS 연동 기반 적응형)
 *
 *  - WEIGHT_ATTENDANCE:     출석률 (LMS 연동 시에만 적용, 미연동 시 0점)
 *  - WEIGHT_ASSIGNMENT:     과제 미제출
 *  - WEIGHT_COUNSELING:     강사 상담 이력
 *  - WEIGHT_AI_BASE:        AI 상호작용 기본 가중치 (LMS 연동 시)
 *  - WEIGHT_AI_NO_LMS_BONUS: LMS 미연동 시 출석 가중치가 AI 상호작용으로 재배분되는 가산점
 *
 * LMS 연동 시:     attendance(20) + assignment(25) + counseling(15) + aiInteraction(40) = 100
 * LMS 미연동 시:   assignment(25) + counseling(15) + aiInteraction(60) = 100
 */
const WEIGHT_ATTENDANCE       = 20;
const WEIGHT_ASSIGNMENT       = 25;
const WEIGHT_COUNSELING       = 15;
const WEIGHT_AI_BASE          = 40;
const WEIGHT_AI_NO_LMS_BONUS  = 20; // LMS 미연동 시 AI 가중치에 추가 (40 → 60)

// ── KST 날짜 유틸리티 ────────────────────────────────────────────────────────

/**
 * KST(Asia/Seoul) 기준 N일 전 자정(00:00 KST)에 해당하는 UTC Date 객체를 반환합니다.
 *
 * 이유: Node.js new Date() 는 내부적으로 UTC 기반이므로
 *       .toISOString().slice(0,10) 는 한국 새벽 0~9시에 전날 날짜를 반환합니다.
 *       본 함수는 Intl.DateTimeFormat 으로 현재 KST 날짜를 고정한 뒤
 *       Date.UTC + KST 오프셋(-9h) 순수 산술로 정확한 경계를 생성합니다.
 *
 * 예시 (한국 시간 2026-04-06 00:30 KST):
 *   kstMidnightDaysAgo(0) → 2026-04-05T15:00:00.000Z  (= KST 2026-04-06 00:00)
 *   kstMidnightDaysAgo(5) → 2026-04-01T15:00:00.000Z  (= KST 2026-04-02 00:00)
 */
export function kstMidnightDaysAgo(daysAgo: number): Date {
  // 현재 시각을 KST YYYY-MM-DD 문자열로 추출 (sv-SE 로케일 = ISO 날짜 형식 보장)
  const kstToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [y, m, d] = kstToday.split('-').map(Number);
  // KST 오늘 자정의 UTC 밀리초 (KST +09:00 → UTC -9h)
  const todayKstMidnightMs = Date.UTC(y!, m! - 1, d!) - 9 * 60 * 60 * 1000;
  return new Date(todayKstMidnightMs - daysAgo * 24 * 60 * 60 * 1000);
}

/**
 * KST 기준 N일 전 날짜 문자열(YYYY-MM-DD)을 반환합니다.
 * attendance_logs.attendance_date (PostgreSQL date 타입) 비교에 사용합니다.
 */
function kstDateStrDaysAgo(daysAgo: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
    kstMidnightDaysAgo(daysAgo),
  );
}

// ── 타입 정의 ────────────────────────────────────────────────────────────────

export interface EwsComponentScores {
  attendance: number;    // 0~20 (LMS 연동 없으면 0, 가중치는 aiInteraction으로 재배분)
  assignment: number;    // 0~25
  counseling: number;    // 0~15
  aiInteraction: number; // 0~40 (LMS 연동 시) or 0~60 (LMS 미연동 시)
}

export interface EwsScoreResult {
  scoreId?: string;    // DB 저장 후 반환된 ews_risk_scores.id (상담 예약 FK 추적용)
  studentId: string;
  courseId: string;
  totalScore: number;
  components: EwsComponentScores;
  riskLevel: 'normal' | 'warning' | 'high_risk' | 'critical';
}

type StudentRow = { id: string; courseId: string };

// ── 메모리 내 세부 점수 산출 (순수 함수) ─────────────────────────────────────

export function scoreAttendance(absentDays: number, hasData: boolean): number {
  if (!hasData)    return 0;                                          // LMS 미연동 → 0 (가중치 재배분)
  if (absentDays === 0) return 0;
  if (absentDays === 1) return Math.round(WEIGHT_ATTENDANCE * 0.5);  // 10점
  return WEIGHT_ATTENDANCE;                                           // 2일 이상 → 20점
}

export function scoreAssignment(missingCount: number): number {
  if (missingCount === 0) return 0;
  if (missingCount === 1) return Math.round(WEIGHT_ASSIGNMENT * 0.5); // 13점
  return WEIGHT_ASSIGNMENT;                                            // 2개 이상 → 25점
}

export function scoreCounseling(negativeCount: number): number {
  if (negativeCount === 0) return 0;
  if (negativeCount === 1) return Math.round(WEIGHT_COUNSELING * 0.5); // 8점
  return WEIGHT_COUNSELING;                                             // 2건 이상 → 15점
}

/**
 * AI 상호작용 복합 지표 점수 산출 (신규 핵심 지표)
 *
 * LMS 연동 여부에 따라 최대 가중치가 달라집니다:
 *  - LMS 연동:    최대 40점 (WEIGHT_AI_BASE)
 *  - LMS 미연동:  최대 60점 (WEIGHT_AI_BASE + WEIGHT_AI_NO_LMS_BONUS)
 *
 * 지표 구성 (세 가지 복합):
 *  1. 활동일 부재 (14일 기준): 오랫동안 AI를 사용하지 않을수록 높은 위험 점수
 *  2. 이번 주 활동 급감: 전주 대비 50% 미만으로 줄어들 경우 추가 가산
 *  3. 완전 비활성: 14일 간 메시지 0건 → 최고 위험
 *
 * @param activeDays    최근 14일 중 AI와 대화한 고유 날짜 수
 * @param thisWeekMsgs  이번 주(7일) 메시지 수
 * @param lastWeekMsgs  전주(8~14일) 메시지 수
 * @param total14dMsgs  14일 전체 메시지 수
 * @param hasLms        LMS 연동 여부 (false 시 가중치 20점 추가)
 */
export function scoreAiInteraction(
  activeDays: number,
  thisWeekMsgs: number,
  lastWeekMsgs: number,
  total14dMsgs: number,
  hasLms: boolean,
): number {
  const maxWeight = WEIGHT_AI_BASE + (hasLms ? 0 : WEIGHT_AI_NO_LMS_BONUS);

  // 1. 14일 완전 비활성 → 즉시 최고 점수
  if (total14dMsgs === 0) return maxWeight;

  // 2. 활동일 기반 점수 (14일 중 몇 일 사용했는지)
  let dayScore: number;
  if (activeDays === 0)      dayScore = maxWeight;                        // 사용 없음
  else if (activeDays <= 2)  dayScore = Math.round(maxWeight * 0.75);     // 14일 중 1~2일
  else if (activeDays <= 5)  dayScore = Math.round(maxWeight * 0.45);     // 3~5일
  else if (activeDays <= 8)  dayScore = Math.round(maxWeight * 0.15);     // 6~8일
  else                       dayScore = 0;                                 // 9일 이상 → 정상

  // 3. 이번 주 활동 급감 (전주 대비 50% 미만)
  let trendPenalty = 0;
  if (lastWeekMsgs > 0 && thisWeekMsgs < lastWeekMsgs * 0.5) {
    trendPenalty = Math.round(maxWeight * 0.25);
  } else if (lastWeekMsgs > 0 && thisWeekMsgs === 0) {
    // 전주엔 활발했는데 이번 주 완전 중단 → 즉시 최고 점수
    return maxWeight;
  }

  // dayScore가 이미 높으면 trend 중복 가산을 억제
  const combined = dayScore >= Math.round(maxWeight * 0.75)
    ? dayScore
    : Math.min(dayScore + trendPenalty, maxWeight);

  return combined;
}

/** @deprecated scoreAiInteraction 으로 대체. 하위 호환성 유지 - 현재 미사용 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function scoreTutorUsage(thisWeek: number, lastWeek: number): number {
  if (thisWeek === 0 && lastWeek === 0) return 0;
  if (thisWeek === 0 && lastWeek > 0)   return 10;
  if (lastWeek === 0)                   return 0;
  const ratio = thisWeek / lastWeek;
  if (ratio >= 0.5) return 0;
  if (ratio > 0)    return 5;
  return 10;
}

/**
 * 위험 등급을 분류합니다.
 *
 * institutionId를 전달하면 GUI에서 설정한 기관별 임계치를 사용합니다.
 * 생략(테스트·단순 호출)하면 기본값(60/75/90)을 사용합니다.
 */
export function classifyRiskLevel(
  score: number,
  institutionId?: string,
): EwsScoreResult['riskLevel'] {
  const thresholds = institutionId
    ? getEwsThresholds(institutionId)
    : { warningThreshold: 60, highRiskThreshold: 75, criticalThreshold: 90 };
  if (score >= thresholds.criticalThreshold)  return 'critical';
  if (score >= thresholds.highRiskThreshold)  return 'high_risk';
  if (score >= thresholds.warningThreshold)   return 'warning';
  return 'normal';
}

// ── Batch 데이터 로드 (4 쿼리) ────────────────────────────────────────────────

/**
 * Batch 데이터 컨테이너
 *  key 형식: `${studentId}:${courseId}`
 */
interface BatchData {
  attendance:       Map<string, Map<string, number>>; // key → Map<status, count>
  attendanceHasData: Set<string>;                     // 출결 기록이 있는 key 집합
  assignment:       Map<string, string[]>;            // key → recent 3개 status[]
  counseling:       Map<string, number>;              // key → negative 상담 수
  tutor:            Map<string, { thisWeek: number; lastWeek: number }>;
  aiActivity:       Map<string, {                     // Q5: AI 상호작용 복합 지표
    activeDays:    number;  // 14일 중 메시지 보낸 고유 날짜 수
    thisWeekMsgs:  number;  // 이번 주(7일) 메시지 수
    lastWeekMsgs:  number;  // 전주(8~14일) 메시지 수
    total14dMsgs:  number;  // 14일 전체 메시지 수
  }>;
}

/**
 * 수강생 목록에 대한 EWS 산출 데이터를 4개의 Batch 쿼리로 한 번에 로드합니다.
 *
 * 쿼리 구성:
 *  Q1. 출결 로그 — IN 배치 + GROUP BY status
 *  Q2. 과제 제출 — ROW_NUMBER() OVER PARTITION 윈도우 함수 (수강생-과목별 최근 3개)
 *  Q3. 상담 이력 — IN 배치 + GROUP BY (negative 2주치)
 *  Q4. AI 튜터  — FILTER 집계로 이번 주·전주 동시 산출 (단일 쿼리)
 */
async function loadBatchData(studentRows: StudentRow[]): Promise<BatchData> {
  const studentIds      = studentRows.map((s) => s.id);
  const fiveDaysAgoDate = kstDateStrDaysAgo(5);           // YYYY-MM-DD (KST 기준)
  const twoWeeksAgoTs   = kstMidnightDaysAgo(14);         // UTC Date (KST 자정 정확 기준)
  const oneWeekAgoTs    = kstMidnightDaysAgo(7);

  // ── Q1. 출결 로그 ──────────────────────────────────────────────────────────
  const rawAttendance = await db
    .select({
      studentId: attendanceLogs.studentId,
      courseId:  attendanceLogs.courseId,
      status:    attendanceLogs.status,
      count:     sql<number>`count(*)::int`,
    })
    .from(attendanceLogs)
    .where(
      and(
        inArray(attendanceLogs.studentId, studentIds),
        sql`${attendanceLogs.attendanceDate} >= ${fiveDaysAgoDate}`,
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .groupBy(attendanceLogs.studentId, attendanceLogs.courseId, attendanceLogs.status);

  const attendance      = new Map<string, Map<string, number>>();
  const attendanceHasData = new Set<string>();
  for (const row of rawAttendance) {
    const key = `${row.studentId}:${row.courseId}`;
    attendanceHasData.add(key);
    if (!attendance.has(key)) attendance.set(key, new Map());
    attendance.get(key)!.set(row.status, row.count);
  }

  // ── Q2. 과제 제출 (ROW_NUMBER 윈도우 — 수강생-과목별 최근 3개) ───────────────
  // Drizzle raw SQL: PostgreSQL 윈도우 함수로 N+1 없이 일괄 처리
  const rawAssignment = await db.execute<{
    student_id: string;
    course_id:  string;
    status:     string;
  }>(sql`
    SELECT student_id, course_id, status
    FROM (
      SELECT
        student_id, course_id, status,
        ROW_NUMBER() OVER (
          PARTITION BY student_id, course_id
          ORDER BY COALESCE(due_at, created_at) DESC
        ) AS rn
      FROM assignment_submissions
      WHERE student_id = ANY(${sql.raw(`ARRAY[${studentIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
        AND deleted_at IS NULL
    ) sub
    WHERE rn <= 3
  `);

  const assignment = new Map<string, string[]>();
  for (const row of rawAssignment) {
    const key = `${row.student_id}:${row.course_id}`;
    if (!assignment.has(key)) assignment.set(key, []);
    assignment.get(key)!.push(row.status);
  }

  // ── Q3. 상담 이력 (최근 2주 negative 카운트) ───────────────────────────────
  const rawCounseling = await db
    .select({
      studentId: counselingNotes.studentId,
      courseId:  counselingNotes.courseId,
      count:     sql<number>`count(*)::int`,
    })
    .from(counselingNotes)
    .where(
      and(
        inArray(counselingNotes.studentId, studentIds),
        eq(counselingNotes.sentiment, 'negative'),
        sql`${counselingNotes.counseledAt} >= ${twoWeeksAgoTs.toISOString()}::timestamptz`,
        isNull(counselingNotes.deletedAt),
      ),
    )
    .groupBy(counselingNotes.studentId, counselingNotes.courseId);

  const counseling = new Map<string, number>();
  for (const row of rawCounseling) {
    counseling.set(`${row.studentId}:${row.courseId}`, row.count);
  }

  // ── Q4. AI 튜터 메시지 (FILTER 집계로 이번 주·전주 동시 산출) ────────────────
  // FILTER(WHERE ...) 는 PostgreSQL 9.4+ 표준 집계 필터.
  // 단일 쿼리로 2기간 카운트를 동시에 산출 → 별도 쿼리 불필요
  const oneWeekIso  = oneWeekAgoTs.toISOString();
  const twoWeekIso  = twoWeeksAgoTs.toISOString();

  const rawTutor = await db.execute<{
    student_id: string;
    course_id:  string;
    this_week:  number;
    last_week:  number;
  }>(sql`
    SELECT
      student_id,
      course_id,
      count(*) FILTER (WHERE created_at >= ${oneWeekIso}::timestamptz)::int                                                    AS this_week,
      count(*) FILTER (WHERE created_at >= ${twoWeekIso}::timestamptz
                         AND created_at <  ${oneWeekIso}::timestamptz)::int AS last_week
    FROM conversation_messages
    WHERE student_id = ANY(${sql.raw(`ARRAY[${studentIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
      AND role = 'user'
      AND created_at >= ${twoWeekIso}::timestamptz
      AND student_id IS NOT NULL
      AND course_id  IS NOT NULL
    GROUP BY student_id, course_id
  `);

  const tutor = new Map<string, { thisWeek: number; lastWeek: number }>();
  for (const row of rawTutor) {
    if (!row.student_id || !row.course_id) continue;
    tutor.set(`${row.student_id}:${row.course_id}`, {
      thisWeek: Number(row.this_week),
      lastWeek: Number(row.last_week),
    });
  }

  // ── Q5. AI 상호작용 복합 지표 (활동일 수 + 빈도 추세) ─────────────────────────
  // 이번 주 / 전주 메시지 수 + 14일 중 활동한 고유 날짜 수를 단일 쿼리로 산출합니다.
  // KST 기준 날짜 경계 처리를 위해 AT TIME ZONE 'Asia/Seoul' 적용.
  const rawAiActivity = await db.execute<{
    student_id:    string;
    course_id:     string;
    active_days:   number;
    this_week_msgs: number;
    last_week_msgs: number;
    total_14d_msgs: number;
  }>(sql`
    SELECT
      student_id,
      course_id,
      count(DISTINCT DATE(created_at AT TIME ZONE 'Asia/Seoul'))::int AS active_days,
      count(*) FILTER (WHERE created_at >= ${oneWeekIso}::timestamptz)::int AS this_week_msgs,
      count(*) FILTER (WHERE created_at >= ${twoWeekIso}::timestamptz
                         AND created_at <  ${oneWeekIso}::timestamptz)::int AS last_week_msgs,
      count(*)::int AS total_14d_msgs
    FROM conversation_messages
    WHERE student_id = ANY(${sql.raw(`ARRAY[${studentIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
      AND role = 'user'
      AND created_at >= ${twoWeekIso}::timestamptz
      AND student_id IS NOT NULL
      AND course_id  IS NOT NULL
    GROUP BY student_id, course_id
  `);

  const aiActivity = new Map<string, {
    activeDays: number; thisWeekMsgs: number; lastWeekMsgs: number; total14dMsgs: number;
  }>();
  for (const row of rawAiActivity) {
    if (!row.student_id || !row.course_id) continue;
    aiActivity.set(`${row.student_id}:${row.course_id}`, {
      activeDays:   Number(row.active_days),
      thisWeekMsgs: Number(row.this_week_msgs),
      lastWeekMsgs: Number(row.last_week_msgs),
      total14dMsgs: Number(row.total_14d_msgs),
    });
  }

  return { attendance, attendanceHasData, assignment, counseling, tutor, aiActivity };
}

// ── 단일 수강생 점수 산출 + 저장 (소량 호출 전용 공개 API) ────────────────────

/**
 * 단일 수강생의 EWS 위험 점수를 산출하고 ews_risk_scores 테이블에 저장합니다.
 * 어드민 즉시 산출 등 소량 단건 API 호출에 사용합니다.
 * runEwsMonitor 와 동일한 배치 인프라를 재사용합니다.
 */
export async function computeAndSaveEwsScore(
  studentId: string,
  courseId: string,
): Promise<EwsScoreResult> {
  const batchData = await loadBatchData([{ id: studentId, courseId }]);
  const key = `${studentId}:${courseId}`;

  const absentDays     = batchData.attendance.get(key)?.get('absent') ?? 0;
  const hasAttData     = batchData.attendanceHasData.has(key);
  const recentStatuses = batchData.assignment.get(key) ?? [];
  const missingCount   = recentStatuses.filter((s) => s === 'missing' || s === 'late').length;
  const negativeCount  = batchData.counseling.get(key) ?? 0;
  const aiEntry        = batchData.aiActivity.get(key) ?? { activeDays: 0, thisWeekMsgs: 0, lastWeekMsgs: 0, total14dMsgs: 0 };

  const components: EwsComponentScores = {
    attendance:    scoreAttendance(absentDays, hasAttData),
    assignment:    scoreAssignment(missingCount),
    counseling:    scoreCounseling(negativeCount),
    aiInteraction: scoreAiInteraction(
      aiEntry.activeDays,
      aiEntry.thisWeekMsgs,
      aiEntry.lastWeekMsgs,
      aiEntry.total14dMsgs,
      hasAttData,   // LMS 연동 여부 = 출결 데이터 존재 여부
    ),
  };
  const totalScore = components.attendance + components.assignment +
                     components.counseling + components.aiInteraction;
  const riskLevel  = classifyRiskLevel(totalScore);

  await db.insert(ewsRiskScores).values({
    studentId,
    courseId,
    totalScore,
    componentScores: components,
    calculatedAt: new Date(),
  });

  return { studentId, courseId, totalScore, components, riskLevel };
}

// ── EWS 모니터 에이전트 진입점 ────────────────────────────────────────────────

export interface EwsRunSummary {
  scannedCount:  number;
  savedCount:    number;
  warningCount:  number;   // 60~74점
  highRiskCount: number;   // 75~89점
  criticalCount: number;   // 90~100점
  scores:        EwsScoreResult[];
  errors:        Array<{ studentId: string; courseId: string; error: string }>;
}

/**
 * EWS 모니터 에이전트 메인 실행 함수.
 * heartbeat.ts 의 executeAgent() 에서 ews_monitor 역할일 때 호출됩니다.
 *
 * 성능 설계:
 *  - 활성 수강생 목록 조회 (1 query)
 *  - Batch 데이터 로드(4 queries) → 메모리 내 점수 계산
 *  - Bulk INSERT → ews_risk_scores (1 query)
 *  = 수강생 수 N에 무관하게 총 6 쿼리
 *
 * @param agent  실행 에이전트 레코드 (institutionId 추출용)
 * @param runId  heartbeat_runs UUID (로깅용)
 */
export async function runEwsMonitor(
  agent: Agent,
  runId: string,
): Promise<EwsRunSummary> {
  const logs: string[] = [];
  logs.push(`[ews_monitor] runId=${runId} 시작`);
  logs.push(`[ews_monitor] 기관 institutionId=${agent.institutionId}`);

  // ── 활성 수강생 조회 ───────────────────────────────────────────────────────
  const activeStudents = await db
    .select({ id: students.id, courseId: students.courseId })
    .from(students)
    .where(
      and(
        eq(students.institutionId, agent.institutionId),
        eq(students.isActive, true),
        isNull(students.deletedAt),
        sql`${students.courseId} IS NOT NULL`,
      ),
    );

  logs.push(`[ews_monitor] 활성 수강생 수: ${activeStudents.length}`);

  const summary: EwsRunSummary = {
    scannedCount:  activeStudents.length,
    savedCount:    0,
    warningCount:  0,
    highRiskCount: 0,
    criticalCount: 0,
    scores:        [],
    errors:        [],
  };

  if (activeStudents.length === 0) {
    logs.push('[ews_monitor] 산출 대상 없음 — 종료');
    logger.info(logs.join('\n'));
    return summary;
  }

  // courseId가 null인 행은 이미 WHERE 조건으로 걸렸지만 타입 안전을 위해 재확인
  const validStudents = activeStudents.filter(
    (s): s is StudentRow => s.courseId !== null,
  );

  // ── Batch 데이터 로드 (4 queries) ────────────────────────────────────────
  let batchData: BatchData;
  try {
    batchData = await loadBatchData(validStudents);
    logs.push('[ews_monitor] Batch 데이터 로드 완료');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`[ews_monitor] Batch 로드 실패: ${msg}`);
    logger.error(logs.join('\n'));
    throw err;
  }

  // ── 메모리 내 점수 계산 ────────────────────────────────────────────────────
  const scoresToInsert: Array<{
    studentId:       string;
    courseId:        string;
    totalScore:      number;
    componentScores: EwsComponentScores;
    calculatedAt:    Date;
  }> = [];

  const now = new Date();

  for (const student of validStudents) {
    try {
      const key = `${student.id}:${student.courseId}`;

      const absentDays     = batchData.attendance.get(key)?.get('absent') ?? 0;
      const hasAttData     = batchData.attendanceHasData.has(key);
      const recentStatuses = batchData.assignment.get(key) ?? [];
      const missingCount   = recentStatuses.filter((s) => s === 'missing' || s === 'late').length;
      const negativeCount  = batchData.counseling.get(key) ?? 0;
      const aiEntry        = batchData.aiActivity.get(key) ?? { activeDays: 0, thisWeekMsgs: 0, lastWeekMsgs: 0, total14dMsgs: 0 };

      const components: EwsComponentScores = {
        attendance:    scoreAttendance(absentDays, hasAttData),
        assignment:    scoreAssignment(missingCount),
        counseling:    scoreCounseling(negativeCount),
        aiInteraction: scoreAiInteraction(
          aiEntry.activeDays,
          aiEntry.thisWeekMsgs,
          aiEntry.lastWeekMsgs,
          aiEntry.total14dMsgs,
          hasAttData,   // LMS 연동 여부 = 출결 데이터 존재 여부
        ),
      };
      const totalScore = components.attendance + components.assignment +
                         components.counseling + components.aiInteraction;
      const riskLevel  = classifyRiskLevel(totalScore, agent.institutionId);

      scoresToInsert.push({
        studentId:       student.id,
        courseId:        student.courseId,
        totalScore,
        componentScores: components,
        calculatedAt:    now,
      });

      const result: EwsScoreResult = {
        studentId: student.id,
        courseId:  student.courseId,
        totalScore,
        components,
        riskLevel,
      };
      summary.scores.push(result);

      if (riskLevel === 'critical')   summary.criticalCount++;
      else if (riskLevel === 'high_risk') summary.highRiskCount++;
      else if (riskLevel === 'warning')   summary.warningCount++;

      logs.push(`[ews_monitor] studentId=${student.id} score=${totalScore} level=${riskLevel}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      summary.errors.push({ studentId: student.id, courseId: student.courseId, error });
      logs.push(`[ews_monitor] ERROR studentId=${student.id} ${error}`);
    }
  }

  // ── Bulk INSERT (1 query) + returning() → scoreId 역추적 ──────────────────
  if (scoresToInsert.length > 0) {
    const inserted = await db
      .insert(ewsRiskScores)
      .values(scoresToInsert)
      .returning({ id: ewsRiskScores.id, studentId: ewsRiskScores.studentId, courseId: ewsRiskScores.courseId });

    // studentId:courseId → scoreId 매핑 (상담 예약 triggeredByScoreId FK 연결용)
    const scoreIdMap = new Map<string, string>();
    for (const row of inserted) {
      scoreIdMap.set(`${row.studentId}:${row.courseId}`, row.id);
    }
    // EwsScoreResult 에 scoreId 주입
    for (const result of summary.scores) {
      const id = scoreIdMap.get(`${result.studentId}:${result.courseId}`);
      if (id) result.scoreId = id;
    }

    summary.savedCount = scoresToInsert.length;
    logs.push(`[ews_monitor] Bulk INSERT 완료: ${summary.savedCount}건`);
  }

  logs.push(
    `[ews_monitor] 완료 — saved=${summary.savedCount} ` +
    `warning=${summary.warningCount} ` +
    `highRisk=${summary.highRiskCount} ` +
    `critical=${summary.criticalCount} ` +
    `errors=${summary.errors.length}`,
  );

  logger.info(logs.join('\n'));
  return summary;
}

