/**
 * heartbeat-proactive.ts — AI 에이전트 자율 발화 서비스
 *
 * 기능:
 *   - heartbeat_enabled 에이전트가 수강생에게 선제적으로 메시지를 발화합니다.
 *   - BullMQ 스케줄러로 에이전트별 발화 주기(intervalSec)마다 실행됩니다.
 *   - 다중 에이전트 교신: heartbeat 활성 에이전트 2개 이상 시 서로 이어받아 대화합니다.
 *   - 무한루프 방지: 동일 세션 내 연속 교신 최대 3회로 제한합니다.
 *   - 비용 제어: heartbeat_daily_limit 초과 시 발화를 건너뜁니다.
 *   - 수강생 동의: student_agent_preferences.heartbeat_disabled = true 이면 발화 안 함.
 *   - 최근 활동 중복 방지: 수강생이 최근 N분 이내 대화했으면 발화를 건너뜁니다.
 */

import {
  db,
  agents,
  agentMessages,
  studentAgentPreferences,
  instructorSkills,
  studentCourses,
  conversationMessages,
  eq,
  and,
  isNull,
  desc,
} from '@openmento/db';
import type { NewAgentMessage } from '@openmento/db';
import { getInstitutionSetting } from './institution-settings-service.js';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig, LlmMessage } from '../adapters/index.js';
import { io } from '../socket/chat.handler.js';
import { checkProactiveBudget, recordCostEvent } from './budget-guard.js';
import { logger } from '../utils/logger.js';

// ── 환경 설정 ────────────────────────────────────────────────────────────────

/** 수강생이 최근 N분 이내 활동 시 heartbeat 발화를 건너뜁니다. */
const SKIP_IF_ACTIVE_WITHIN_MINUTES = parseInt(
  process.env.HEARTBEAT_SKIP_ACTIVE_MINUTES ?? '30',
  10,
);

/** 에이전트 간 연속 교신 최대 턴 수 (무한루프 방지) */
const MAX_CHAIN_TURNS = parseInt(process.env.HEARTBEAT_MAX_CHAIN_TURNS ?? '3', 10);

interface AdminSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openclawApiKey?: string;
  geminiApiKey?: string;
  [key: string]: string | undefined;
}

const safeKey = (v: string | undefined): string | undefined =>
  typeof v === 'string' && v.length > 0 && !v.includes('\u2022') ? v : undefined;

function resolveApiKey(provider: string, secrets: AdminSecrets): string | undefined {
  switch (provider) {
    case 'google': return safeKey(secrets.geminiApiKey) ?? safeKey(process.env.GEMINI_API_KEY);
    case 'openai': return safeKey(secrets.openaiApiKey) ?? safeKey(process.env.OPENAI_API_KEY);
    case 'anthropic': return safeKey(secrets.anthropicApiKey) ?? safeKey(process.env.ANTHROPIC_API_KEY);
    case 'openclaw': return safeKey(secrets.openclawApiKey) ?? safeKey(process.env.OPENCLAW_API_KEY);
    default: return undefined;
  }
}

// ── 핵심 발화 함수 ───────────────────────────────────────────────────────────

export interface HeartbeatProactiveOptions {
  agentId: string;
  studentId: string;
  courseId: string;
  institutionId: string;
  /** 교신 체인 추적용 원본 메시지 ID (에이전트 간 답장 시) */
  triggerMessageId?: string;
  /** 교신 체인 현재 턴 번호 (무한루프 방지) */
  turnIndex?: number;
}

/**
 * 에이전트가 수강생에게 heartbeat 메시지를 발화합니다.
 * Socket.IO로 즉시 전달하고 agent_messages에 저장합니다.
 */
export async function sendHeartbeatMessage(opts: HeartbeatProactiveOptions): Promise<string | null> {
  const { agentId, studentId, courseId, institutionId, triggerMessageId, turnIndex = 0 } = opts;

  // 1. 무한루프 방지
  if (turnIndex >= MAX_CHAIN_TURNS) {
    logger.info({ agentId, studentId, courseId, turnIndex }, '[heartbeat-proactive] max chain turns reached, skipping');
    return null;
  }

  // 2. 에이전트 조회
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.isActive, true), isNull(agents.deletedAt)))
    .limit(1);

  if (!agent) return null;

  // 3. 에이전트 heartbeat 설정 확인
  const hbConfig = (agent.runtimeConfig as { heartbeat?: { enabled?: boolean; intervalSec?: number; maxConcurrentRuns?: number; promptTemplate?: string; dailyLimit?: number; proactive?: boolean } }).heartbeat;
  if (!hbConfig?.enabled || !hbConfig?.proactive) return null;

  // 4. 예산 가드
  const budgetCheck = await checkProactiveBudget(agentId, institutionId);
  if (!budgetCheck.allowed) {
    logger.info({ agentId, reason: budgetCheck.reason }, '[heartbeat-proactive] budget guard blocked');
    return null;
  }

  // 5. 기관 API 키 로드
  const secretsRaw = await getInstitutionSetting(institutionId, 'secrets', {});
  const secrets = (secretsRaw ?? {}) as AdminSecrets;
  const adapterConf = agent.adapterConfig as AdapterConfig;
  const apiKey = resolveApiKey(adapterConf.provider, secrets);
  if (!apiKey) {
    logger.warn({ agentId, provider: adapterConf.provider }, '[heartbeat-proactive] no API key found');
    return null;
  }

  // 6. 발화 프롬프트 구성
  const heartbeatPrompt = hbConfig.promptTemplate ??
    `당신은 학습을 돕는 AI 튜터입니다. 수강생이 학습 의지를 유지할 수 있도록 짧은 격려 메시지나 학습 점검 질문을 발화하세요. 2~3문장으로 간결하게 작성하세요.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: heartbeatPrompt },
    { role: 'user', content: '(heartbeat trigger — generate a proactive student engagement message)' },
  ];

  // 7. LLM 호출
  let answer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let model = adapterConf.model ?? 'unknown';

  try {
    const adapter = createAdapterWithFallback(
      { ...adapterConf, apiKey },
      agent.fallbackAdapterConfig ? { ...(agent.fallbackAdapterConfig as AdapterConfig), apiKey } : undefined,
    );

    if (!adapter) {
      logger.warn({ agentId }, '[heartbeat-proactive] no adapter created');
      return null;
    }

    const result = await adapter.chat(messages);

    answer = result.content;
    inputTokens = result.inputTokens ?? 0;
    outputTokens = result.outputTokens ?? 0;
    model = result.model ?? model;

    // 비용 기록
    await recordCostEvent({
      agentId,
      institutionId,
      provider: adapterConf.provider,
      model,
      inputTokens,
      outputTokens,
    });
  } catch (err) {
    logger.error({ agentId, err }, '[heartbeat-proactive] LLM call failed');
    return null;
  }

  if (!answer.trim()) return null;

  // 8. agent_messages 저장
  const [saved] = await db
    .insert(agentMessages)
    .values({
      institutionId,
      authorAgentId: agentId,
      targetStudentId: studentId,
      courseId,
      body: answer,
      messageType: triggerMessageId ? 'agent_reply' : 'heartbeat',
      turnIndex,
      triggerMessageId: triggerMessageId ?? null,
      delivered: 'pending',
    } as NewAgentMessage)
    .returning({ id: agentMessages.id });

  const messageId = saved?.id;

  // 9. Socket.IO로 수강생 채팅창에 전달
  if (io && messageId) {
    io.to(`student:${studentId}`).emit('heartbeat_message', {
      messageId,
      body: answer,
      agentId,
      agentName: agent.title ?? agent.name,
      courseId,
      messageType: triggerMessageId ? 'agent_reply' : 'heartbeat',
      turnIndex,
      createdAt: new Date().toISOString(),
    });

    // delivered 상태 업데이트
    await db
      .update(agentMessages)
      .set({ delivered: 'sent' })
      .where(eq(agentMessages.id, messageId));
  }

  logger.info({ agentId, studentId, courseId, messageId, turnIndex }, '[heartbeat-proactive] message sent');

  return messageId ?? null;
}

// ── 에이전트 간 교신 체인 ───────────────────────────────────────────────────

/**
 * 특정 수강생+과목에서 heartbeat 활성 에이전트가 2개 이상이면
 * 에이전트 간 교신 체인을 시작합니다.
 * 에이전트 A 발화 → 에이전트 B가 A 메시지를 받아 응답 → (최대 MAX_CHAIN_TURNS)
 */
export async function triggerAgentChain(opts: {
  triggerMessageId: string;
  triggerAgentId: string;
  studentId: string;
  courseId: string;
  institutionId: string;
  currentTurnIndex: number;
}): Promise<void> {
  const { triggerMessageId, triggerAgentId, studentId, courseId, institutionId, currentTurnIndex } = opts;

  if (currentTurnIndex >= MAX_CHAIN_TURNS) return;

  // 같은 과목에서 heartbeat 활성화된 다른 에이전트 찾기
  const peerRows = await db
    .select({
      agentId: instructorSkills.agentId,
      heartbeatDisabled: studentAgentPreferences.heartbeatDisabled,
      isActive: studentAgentPreferences.isActive,
    })
    .from(instructorSkills)
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
        eq(instructorSkills.isActive, true),
        isNull(instructorSkills.deletedAt),
      ),
    );

  for (const row of peerRows) {
    if (!row.agentId) continue;
    if (row.agentId === triggerAgentId) continue; // 자기 자신 제외
    if (row.isActive === false) continue; // 수강생이 비활성화한 에이전트 제외
    if (row.heartbeatDisabled !== false) continue; // heartbeat 비활성 에이전트 제외

    // 피어 에이전트도 heartbeat_enabled인지 확인
    const [peer] = await db
      .select({ runtimeConfig: agents.runtimeConfig })
      .from(agents)
      .where(and(eq(agents.id, row.agentId), eq(agents.isActive, true), isNull(agents.deletedAt)))
      .limit(1);

    const peerHb = (peer?.runtimeConfig as { heartbeat?: { enabled?: boolean; proactive?: boolean } })?.heartbeat;
    if (!peerHb?.enabled || !peerHb?.proactive) continue;

    await sendHeartbeatMessage({
      agentId: row.agentId,
      studentId,
      courseId,
      institutionId,
      triggerMessageId,
      turnIndex: currentTurnIndex + 1,
    });
  }
}

// ── 토론 체인 (수강생 채팅 → 다중 에이전트 토론) ───────────────────────────────

/**
 * 수강생이 메시지를 보냈을 때 (debateMode=true) 1차 응답 에이전트 외
 * 같은 과목에 할당된 heartbeat 활성 에이전트들이 사용자의 질문에 대해
 * 각자의 관점으로 토론 응답을 생성하여 클라이언트에 전달합니다.
 */
export async function triggerDebateChain(opts: {
  question: string;
  primaryAgentId: string;
  primaryAnswer: string;
  studentId: string;
  courseId: string;
  institutionId: string;
}): Promise<void> {
  const { question, primaryAgentId, primaryAnswer, studentId, courseId, institutionId } = opts;

  // 1차 에이전트 정보 조회 (토론 프롬프트에서 언급하기 위해)
  const [primaryAgent] = await db
    .select({ name: agents.name, title: agents.title })
    .from(agents)
    .where(and(eq(agents.id, primaryAgentId), eq(agents.isActive, true), isNull(agents.deletedAt)))
    .limit(1);

  const primaryAgentName = primaryAgent?.title ?? primaryAgent?.name ?? 'AI';

  // 같은 과목에 할당된 다른 에이전트 목록
  const peerRows = await db
    .select({
      agentId: instructorSkills.agentId,
      isActive: studentAgentPreferences.isActive,
    })
    .from(instructorSkills)
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
        eq(instructorSkills.isActive, true),
        isNull(instructorSkills.deletedAt),
      ),
    );

  const peerAgentIds = peerRows
    .filter((r) => r.agentId && r.agentId !== primaryAgentId && r.isActive !== false)
    .map((r) => r.agentId as string);

  if (peerAgentIds.length === 0) {
    logger.info({ primaryAgentId, courseId }, '[heartbeat-proactive] debate: no peer agents found');
    return;
  }

  // 기관 시크릿 (한 번만 조회)
  const secretsRaw = await getInstitutionSetting(institutionId, 'secrets', {});
  const secrets = (secretsRaw ?? {}) as AdminSecrets;

  for (const peerAgentId of peerAgentIds) {
    const [peer] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, peerAgentId), eq(agents.isActive, true), isNull(agents.deletedAt)))
      .limit(1);

    if (!peer) continue;

    // heartbeat.enabled인 에이전트만 토론에 참여
    const hbConfig = (peer.runtimeConfig as { heartbeat?: { enabled?: boolean } })?.heartbeat;
    if (!hbConfig?.enabled) continue;

    const adapterConf = peer.adapterConfig as AdapterConfig;
    const apiKey = resolveApiKey(adapterConf.provider, secrets);
    if (!apiKey) {
      logger.warn({ peerAgentId, provider: adapterConf.provider }, '[heartbeat-proactive] debate: no API key');
      continue;
    }

    // 토론 프롬프트 구성 — 에이전트 고유 성격(systemPrompt) + 토론 지시
    const agentPersonality = (peer as { systemPrompt?: string | null }).systemPrompt
      ? `${(peer as { systemPrompt?: string | null }).systemPrompt}\n\n`
      : '';
    const debateSystemPrompt =
      `${agentPersonality}당신은 AI 토론 참여자입니다. 수강생의 질문에 대해 ${primaryAgentName}(이)라는 다른 AI가 이미 답변했습니다. ` +
      `당신만의 독창적인 관점, 보완적 시각, 또는 반론을 제시하여 학습 토론을 풍성하게 만드세요. 2~4문장으로 간결하게 답하세요.`;

    const messages: LlmMessage[] = [
      { role: 'system', content: debateSystemPrompt },
      {
        role: 'user',
        content: `수강생 질문: ${question}\n\n${primaryAgentName}의 답변:\n${primaryAnswer}`,
      },
    ];

    let answer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let model = adapterConf.model ?? 'unknown';

    try {
      const adapter = createAdapterWithFallback(
        { ...adapterConf, apiKey },
        peer.fallbackAdapterConfig ? { ...(peer.fallbackAdapterConfig as AdapterConfig), apiKey } : undefined,
      );
      if (!adapter) continue;

      const result = await adapter.chat(messages);
      answer = result.content;
      inputTokens = result.inputTokens ?? 0;
      outputTokens = result.outputTokens ?? 0;
      model = result.model ?? model;

      await recordCostEvent({ agentId: peerAgentId, institutionId, provider: adapterConf.provider, model, inputTokens, outputTokens });
    } catch (err) {
      logger.error({ peerAgentId, err }, '[heartbeat-proactive] debate LLM call failed');
      continue;
    }

    if (!answer.trim()) continue;

    // DB 저장
    const [saved] = await db
      .insert(agentMessages)
      .values({
        institutionId,
        authorAgentId: peerAgentId,
        targetStudentId: studentId,
        courseId,
        body: answer,
        messageType: 'agent_reply',
        turnIndex: 1,
        triggerMessageId: null,
        delivered: 'pending',
      } as NewAgentMessage)
      .returning({ id: agentMessages.id });

    const messageId = saved?.id;

    if (io && messageId) {
      io.to(`student:${studentId}`).emit('heartbeat_message', {
        messageId,
        body: answer,
        agentId: peerAgentId,
        agentName: peer.title ?? peer.name,
        courseId,
        messageType: 'debate',
        turnIndex: 1,
        createdAt: new Date().toISOString(),
      });

      await db
        .update(agentMessages)
        .set({ delivered: 'sent' })
        .where(eq(agentMessages.id, messageId));
    }

    logger.info({ peerAgentId, studentId, courseId }, '[heartbeat-proactive] debate message sent');
  }
}

// ── 스케줄러 (1분 간격 cron) ──────────────────────────────────────────────────

let _proactiveInterval: NodeJS.Timeout | null = null;

/**
 * Heartbeat 프로액티브 스캔을 1분 간격으로 시작합니다.
 * REDIS_URL 없이도 작동합니다 (setInterval 기반 fallback).
 */
export function startHeartbeatProactiveScheduler(): void {
  if (_proactiveInterval) return;

  const intervalMs = parseInt(process.env.HEARTBEAT_PROACTIVE_INTERVAL_MS ?? '60000', 10);

  _proactiveInterval = setInterval(() => {
    void runHeartbeatProactiveScan();
  }, intervalMs);

  logger.info({ intervalMs }, '[heartbeat-proactive] scheduler started');
}

export function stopHeartbeatProactiveScheduler(): void {
  if (_proactiveInterval) {
    clearInterval(_proactiveInterval);
    _proactiveInterval = null;
    logger.info('[heartbeat-proactive] scheduler stopped');
  }
}

// ── 전체 스캔 (스케줄러에서 호출) ───────────────────────────────────────────

/**
 * heartbeat_enabled 에이전트를 가진 모든 수강생을 스캔하여
 * 적절한 경우 heartbeat 메시지를 발화합니다.
 * BullMQ 스케줄러에서 1분마다 호출합니다.
 */
export async function runHeartbeatProactiveScan(opts?: { force?: boolean; institutionId?: string }): Promise<void> {
  const forceMode = opts?.force ?? false;
  const filterInstitutionId = opts?.institutionId;
  try {
    // heartbeat 활성 에이전트 목록 조회
    const heartbeatAgents = await db
      .select({
        agentId: agents.id,
        institutionId: agents.institutionId,
        runtimeConfig: agents.runtimeConfig,
      })
      .from(agents)
      .where(and(eq(agents.isActive, true), isNull(agents.deletedAt)))
      .then((rows) =>
        rows.filter((r) => {
          const hb = (r.runtimeConfig as { heartbeat?: { enabled?: boolean; proactive?: boolean } })?.heartbeat;
          const matchInstitution = filterInstitutionId ? r.institutionId === filterInstitutionId : true;
          return hb?.enabled === true && hb?.proactive === true && matchInstitution;
        }),
      );

    if (heartbeatAgents.length === 0) return;

    for (const agRow of heartbeatAgents) {
      // 이 에이전트가 할당된 과목 수강생 조회
      const enrollments = await db
        .select({
          studentId: studentCourses.studentId,
          courseId: studentCourses.courseId,
        })
        .from(instructorSkills)
        .innerJoin(studentCourses, eq(studentCourses.courseId, instructorSkills.courseId))
        .leftJoin(
          studentAgentPreferences,
          and(
            eq(studentAgentPreferences.studentId, studentCourses.studentId),
            eq(studentAgentPreferences.courseId, studentCourses.courseId),
            eq(studentAgentPreferences.agentId, agRow.agentId),
          ),
        )
        .where(
          and(
            eq(instructorSkills.agentId, agRow.agentId),
            eq(instructorSkills.isActive, true),
            isNull(instructorSkills.deletedAt),
          ),
        )
        .then((rows) =>
          rows.filter((r) => {
            // studentAgentPreferences가 없으면 (기본값 비활성) — heartbeat 안 함
            // heartbeatDisabled = false 인 경우만 발화
            const pref = r as typeof r & { heartbeatDisabled?: boolean; isActive?: boolean };
            return pref.isActive !== false && pref.heartbeatDisabled === false;
          }),
        );

      for (const enroll of enrollments) {
        // 최근 활동 체크 — force 모드에서는 건너뜀
        if (!forceMode) {
          const [lastMsg] = await db
            .select({ createdAt: conversationMessages.createdAt })
            .from(conversationMessages)
            .where(eq(conversationMessages.studentId, enroll.studentId))
            .orderBy(desc(conversationMessages.createdAt))
            .limit(1);

          if (lastMsg?.createdAt) {
            const minutesAgo =
              (Date.now() - new Date(lastMsg.createdAt).getTime()) / 60000;
            if (minutesAgo < SKIP_IF_ACTIVE_WITHIN_MINUTES) {
              continue; // 최근 활동 중 — 건너뜀
            }
          }
        }

        // 발화
        const messageId = await sendHeartbeatMessage({
          agentId: agRow.agentId,
          studentId: enroll.studentId,
          courseId: enroll.courseId,
          institutionId: agRow.institutionId,
          turnIndex: 0,
        });

        // 다중 에이전트 교신 체인 트리거
        if (messageId) {
          await triggerAgentChain({
            triggerMessageId: messageId,
            triggerAgentId: agRow.agentId,
            studentId: enroll.studentId,
            courseId: enroll.courseId,
            institutionId: agRow.institutionId,
            currentTurnIndex: 0,
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, '[heartbeat-proactive] scan failed');
  }
}
