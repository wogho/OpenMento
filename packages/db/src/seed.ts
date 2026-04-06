/**
 * EduClip 개발용 시드 데이터 스크립트
 * 실행: pnpm --filter @educlip/db db:seed
 *
 * 생성 데이터:
 *  - 교육기관 1개 (테스트 교육기관)
 *  - 과정 2개 (Java반, Python반)
 *  - 수강생 4명
 *  - 에이전트 7개 (오케스트레이터 + 하위 에이전트)
 *  - 스케줄 루틴 3개 (매시간, 매일, 매주)
 *  - 예산 정책 1개
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL 환경변수가 필요합니다.');
}

const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

async function seed() {
  console.log('🌱 시드 데이터 입력 시작...');

  // ── 1. 교육기관 ────────────────────────────────────────────
  const [institution] = await db
    .insert(schema.institutions)
    .values({
      name: '테스트 교육기관',
      slug: 'test-edu',
      contactEmail: 'admin@test-edu.example.com',
      isActive: true,
    })
    .onConflictDoNothing()
    .returning();

  if (!institution) {
    console.log('  ↳ 교육기관 이미 존재 (skip)');
    await sql.end();
    return;
  }

  console.log(`  ✓ 교육기관: ${institution.name} (${institution.id})`);

  // ── 2. 과정 ───────────────────────────────────────────────
  const [javaCourse, pythonCourse] = await db
    .insert(schema.courses)
    .values([
      {
        institutionId: institution.id,
        name: 'Java 백엔드 개발자 과정',
        subject: 'java',
        isActive: true,
      },
      {
        institutionId: institution.id,
        name: 'Python AI 개발자 과정',
        subject: 'python',
        isActive: true,
      },
    ])
    .returning();

  console.log(`  ✓ 과정: ${javaCourse.name}, ${pythonCourse.name}`);

  // ── 3. 수강생 (익명 ID + 실명 분리) ──────────────────────
  const studentSeed = [
    { courseId: javaCourse.id, displayName: '김*수' },
    { courseId: javaCourse.id, displayName: '이*영' },
    { courseId: pythonCourse.id, displayName: '박*준' },
    { courseId: pythonCourse.id, displayName: '최*아' },
  ];

  await db.insert(schema.students).values(
    studentSeed.map((s) => ({
      institutionId: institution.id,
      courseId: s.courseId,
      displayName: s.displayName,
      isActive: true,
    })),
  );

  console.log(`  ✓ 수강생 ${studentSeed.length}명 생성`);

  // ── 4. 에이전트 (오케스트레이터 먼저) ─────────────────────
  const [orchestrator] = await db
    .insert(schema.agents)
    .values({
      institutionId: institution.id,
      name: '오케스트레이터',
      slug: 'orchestrator',
      role: 'orchestrator',
      adapterConfig: { provider: 'openai', model: 'gpt-4o' },
      fallbackAdapterConfig: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      isActive: true,
    })
    .returning();

  const [ewsMonitor] = await db
    .insert(schema.agents)
    .values({
      institutionId: institution.id,
      name: 'EWS 모니터',
      slug: 'ews-monitor',
      role: 'ews_monitor',
      reportsTo: orchestrator.id,
      adapterConfig: { provider: 'openai', model: 'gpt-4o-mini' },
      fallbackAdapterConfig: { provider: 'google', model: 'gemini-2.0-flash' },
      isActive: true,
    })
    .returning();

  const subAgents = await db
    .insert(schema.agents)
    .values([
      {
        institutionId: institution.id,
        name: 'AI 강사 (Java반)',
        slug: 'ai-instructor-java',
        role: 'ai_instructor',
        reportsTo: orchestrator.id,
        adapterConfig: { provider: 'anthropic', model: 'claude-haiku-3-5' },
        fallbackAdapterConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        isActive: true,
      },
      {
        institutionId: institution.id,
        name: 'AI 강사 (Python반)',
        slug: 'ai-instructor-python',
        role: 'ai_instructor',
        reportsTo: orchestrator.id,
        adapterConfig: { provider: 'anthropic', model: 'claude-haiku-3-5' },
        fallbackAdapterConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        isActive: true,
      },
      {
        institutionId: institution.id,
        name: 'AI 튜터',
        slug: 'ai-tutor',
        role: 'ai_tutor',
        reportsTo: orchestrator.id,
        adapterConfig: { provider: 'anthropic', model: 'claude-haiku-3-5' },
        fallbackAdapterConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        isActive: true,
      },
      {
        institutionId: institution.id,
        name: '멘탈케어 에이전트',
        slug: 'mental-care',
        role: 'mental_care',
        reportsTo: ewsMonitor.id,
        adapterConfig: { provider: 'anthropic', model: 'claude-haiku-3-5' },
        fallbackAdapterConfig: { provider: 'openai', model: 'gpt-4o-mini' },
        isActive: true,
      },
      {
        institutionId: institution.id,
        name: '포트폴리오 심사',
        slug: 'portfolio-reviewer',
        role: 'portfolio_reviewer',
        reportsTo: orchestrator.id,
        adapterConfig: { provider: 'openai', model: 'gpt-4o' },
        fallbackAdapterConfig: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        isActive: true,
      },
    ])
    .returning();

  console.log(`  ✓ 에이전트 ${2 + subAgents.length}개 생성 (오케스트레이터 계층 포함)`);

  // ── 5. Heartbeat 스케줄 루틴 3개 ─────────────────────────
  const [routine1, routine2, routine3] = await db
    .insert(schema.routines)
    .values([
      {
        institutionId: institution.id,
        agentId: ewsMonitor.id,
        name: '당일 출결 스캔 (매시간)',
        isActive: true,
      },
      {
        institutionId: institution.id,
        agentId: ewsMonitor.id,
        name: '전일 종합 위험 점수 산출 + 일일 리포트 (매일 07:00)',
        isActive: true,
      },
      {
        institutionId: institution.id,
        agentId: ewsMonitor.id,
        name: '주간 트렌드 분석 + 주간 보고서 (매주 월 09:00)',
        isActive: true,
      },
    ])
    .returning();

  await db.insert(schema.routineTriggers).values([
    { routineId: routine1.id, kind: 'cron', cronExpression: '0 * * * *', isActive: true },
    { routineId: routine2.id, kind: 'cron', cronExpression: '0 7 * * *', isActive: true },
    { routineId: routine3.id, kind: 'cron', cronExpression: '0 9 * * 1', isActive: true },
  ]);

  console.log('  ✓ Heartbeat 루틴 3개 생성 (매시간/매일/매주)');

  // ── 6. 예산 정책 ──────────────────────────────────────────
  await db.insert(schema.budgetPolicies).values({
    institutionId: institution.id,
    period: 'monthly',
    limitUsd: 50.0,
    alertThresholdPct: 80,
    onExceed: 'pause',
  });

  console.log('  ✓ 예산 정책 생성 ($50/월, 80% Soft Alert)');

  console.log('\n✅ 시드 데이터 입력 완료!');
  await sql.end();
}

seed().catch((err) => {
  console.error('❌ 시드 실패:', err);
  process.exit(1);
});
