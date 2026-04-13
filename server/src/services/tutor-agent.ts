/**
 * AI 튜터 에이전트 서비스 (plan.md 1-2)
 *
 * 역할: 수강생의 질문을 받아
 *  1. RAG 유사도 검색으로 관련 교재 청크를 가져오고
 *  2. 소크라테스식 System Prompt를 조합해
 *  3. LLM에 Multi-turn 대화 이력과 함께 전달하고
 *  4. 응답과 이력을 PostgreSQL conversation_messages 테이블에 저장합니다.
 *
 * agentId / adapterConfig 는 DB의 agents 레코드에서 읽어오므로
 * GUI에서 모델을 교체해도 코드 변경이 필요 없습니다.
 */

import { eq, asc, desc, and, isNull, ne, db, conversationMessages, agents, studentSkills, instructorSkills, students, studentCourses } from '@openmento/db';
import { searchSimilarChunks } from '@openmento/rag';
import { buildSystemPrompt } from './prompts.js';
import { PostHog } from 'posthog-node';

// ── PostHog Node 셋업 (Phase 6-3) ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const posthog = new PostHog(
  process.env.POSTHOG_API_KEY || 'phc_mock_node_key_for_openmento',
  { host: process.env.POSTHOG_HOST || 'https://app.posthog.com' }
);

import { getSkillMarkdown } from './skill-injector.js';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig, LlmMessage } from '../adapters/index.js';
import { checkProactiveBudget, recordCostEvent } from './budget-guard.js';
import { getInstitutionSetting } from './institution-settings-service.js';

// ── 기관 secrets에서 provider별 API 키 resolve ───────────────────────────
// 매 요청 시 DB(캐시)에서 읽어 process.env 의존을 제거합니다.
interface AdminSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openclawApiKey?: string;
  geminiApiKey?: string;
  [key: string]: string | undefined;
}

/** 마스킹 문자(•, U+2022)가 포함된 값은 반환하지 않음 */
const safeKey = (v: string | undefined): string | undefined =>
  typeof v === 'string' && v.length > 0 && !v.includes('\u2022') ? v : undefined;

function resolveApiKeyFromSecrets(provider: string, secrets: AdminSecrets): string | undefined {
  switch (provider) {
    case 'google':
      return safeKey(secrets.geminiApiKey);
    case 'openai':
      return safeKey(secrets.openaiApiKey);
    case 'anthropic':
      return safeKey(secrets.anthropicApiKey);
    case 'openclaw':
      return safeKey(secrets.openclawApiKey);
    default:
      return undefined;
  }
}

// ── 동료 에이전트 역량(capabilities) 컨텍스트 조합 ─────────────────────────
// 오케스트레이터가 위임 결정을 내릴 때 각 에이전트의 capabilities 를 LLM 프롬프트에 주입합니다.
async function buildCapabilitiesContext(institutionId: string, selfAgentId: string): Promise<string> {
  const peers = await db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      title: agents.title,
      capabilities: agents.capabilities,
      status: agents.status,
    })
    .from(agents)
    .where(
      and(
        eq(agents.institutionId, institutionId),
        ne(agents.id, selfAgentId),
        eq(agents.isActive, true),
        isNull(agents.deletedAt),
      ),
    );

  const active = peers.filter((p) => p.capabilities && p.status !== 'terminated' && p.status !== 'paused');
  if (active.length === 0) return '';

  const lines = active.map((p) => {
    const displayName = p.title ?? p.name;
    return `- **${displayName}** (${p.role}, id: ${p.id.slice(0, 8)}…): ${p.capabilities}`;
  });

  return [
    '## 위임 가능한 에이전트 목록',
    '아래 에이전트에게 적절한 작업을 위임할 수 있습니다. 위임 시 agentId를 명시하세요.',
    ...lines,
  ].join('\n');
}

// ── 타입 ─────────────────────────────────────────────────────────────────
export interface TutorChatOptions {
  /** 대화 세션 UUID. 없으면 신규 세션 UUID를 자동 생성합니다. */
  sessionId?: string;
  /** 수강생 userId (JWT sub, students.id) */
  studentId: string;
  /** 수강생의 기관 UUID */
  institutionId: string;
  /** 수강생의 과목 UUID (있으면 해당 과목 교재로 RAG 범위 제한) */
  courseId?: string;
  /** 수강생 질문 */
  question: string;
  /** DB agents.id — 이 에이전트 설정으로 모델을 결정합니다. */
  agentId: string;
}

export interface TutorChatResult {
  sessionId: string;
  answer: string;
  ragSourceCount: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// ── 세션 내 이력 조회 최대 메시지 수 ────────────────────────────────────
// 너무 많은 이력을 주입하면 컨텍스트 윈도우를 초과하므로 최근 N쌍(Q&A)으로 제한
const MAX_HISTORY_TURNS = 10; // user + assistant 각 10개 = 최대 20 메시지

// ── 핵심 에이전트 함수 ────────────────────────────────────────────────────
export async function tutorChat(options: TutorChatOptions): Promise<TutorChatResult> {
  const { studentId, institutionId, courseId, question, agentId } = options;
  const sessionId = options.sessionId ?? crypto.randomUUID();

  // ── 0. 학생 계정/소속 검증 ───────────────────────────────────────────
  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, studentId),
        eq(students.institutionId, institutionId),
        eq(students.isActive, true),
        isNull(students.deletedAt),
      ),
    )
    .limit(1);

  if (!student) {
    throw new Error('유효한 학생 계정이 아닙니다. /auth/student-login으로 로그인한 학생 토큰인지 확인해 주세요.');
  }

  if (courseId) {
    const [enrollment] = await db
      .select({ id: studentCourses.id })
      .from(studentCourses)
      .where(
        and(
          eq(studentCourses.studentId, studentId),
          eq(studentCourses.courseId, courseId),
          eq(studentCourses.isActive, true),
          isNull(studentCourses.deletedAt),
        ),
      )
      .limit(1);

    if (!enrollment) {
      throw new Error('해당 과목에 배정된 수강생이 아니어서 채팅할 수 없습니다. 과목 배정을 확인해 주세요.');
    }
  }

  // ── 1. DB에서 에이전트 설정 로드 ──────────────────────────────────────
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.institutionId, institutionId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);

  if (!agent) {
    throw new Error(`에이전트를 찾을 수 없습니다. agentId=${agentId}`);
  }

  // ── 1-a. 에이전트 상태 사전 검사 ──────────────────────────────────────
  if (agent.status === 'terminated') {
    throw new Error('이 에이전트는 영구 종료(terminated) 상태입니다. 관리자에게 문의하세요.');
  }
  if (agent.status === 'paused') {
    throw new Error('이 에이전트는 현재 일시정지(paused) 상태입니다. 잠시 후 다시 시도하거나 관리자에게 문의하세요.');
  }

  // ── 1-b. 예산 사전 검사 (Circuit Breaker) ─────────────────────────────
  const budgetCheck = await checkProactiveBudget(institutionId, agentId);
  if (!budgetCheck.allowed) {
    throw new Error(`예산 한도 초과: ${budgetCheck.reason}`);
  }

  const adapterConfig = agent.adapterConfig as AdapterConfig;
  const fallbackConfig = agent.fallbackAdapterConfig as AdapterConfig | null | undefined;
  const agentRole = agent.role;

  // ── secrets에서 API 키 resolve (process.env 의존 제거) ──────────────
  const secrets = await getInstitutionSetting<AdminSecrets>(institutionId, 'secrets', {});
  const primaryKey = resolveApiKeyFromSecrets(adapterConfig.provider, secrets);
  const resolvedPrimary: AdapterConfig = primaryKey
    ? { ...adapterConfig, apiKey: primaryKey }
    : adapterConfig;
  const resolvedFallback: AdapterConfig | null | undefined = fallbackConfig
    ? (() => {
        const fbKey = resolveApiKeyFromSecrets(fallbackConfig.provider, secrets);
        return fbKey ? { ...fallbackConfig, apiKey: fbKey } : fallbackConfig;
      })()
    : fallbackConfig;

  const llm = createAdapterWithFallback(resolvedPrimary, resolvedFallback);

  // ── 2. RAG 유사도 검색 (에이전트 ragEnabled=true일 때만 실행) ────────
  // ragEnabled=false면 교재 벡터 검색을 완전히 건너뛰어 OpenAI 임베딩 API를 호출하지 않습니다.
  // ragEnabled=true이고 OpenAI 키가 있으면 교재 청크 TOP-3을 검색합니다.
  // OpenAI 키가 없으면 경고만 출력하고 LLM만으로 응답합니다 (graceful degradation).
  const ragApiKey = secrets.openaiApiKey ?? secrets.ragOpenaiApiKey;
  let ragResults: Awaited<ReturnType<typeof searchSimilarChunks>> = [];
  if (agent.ragEnabled !== false) {
    try {
      ragResults = await searchSimilarChunks(question, {
        institutionId,
        courseId,
        topK: 3,
        apiKey: ragApiKey,
      });
    } catch (ragErr) {
      // RAG 실패(API 키 없음 포함) 시 RAG 없이 계속 진행합니다.
      console.warn('[tutor-agent] RAG 검색 실패 — RAG 없이 응답 진행:', ragErr instanceof Error ? ragErr.message : ragErr);
    }
  }

  // ── 3. System Prompt 조합 ────────────────────────────────────────────
  // 기본 에이전트 스킬
  // courseId가 있으면 해당 과목+에이전트에 연결된 활성 instructor 스킬을 모두 병합해 우선 사용합니다.
  const courseBoundSkills = courseId
    ? await db
        .select({ markdown: instructorSkills.markdown })
        .from(instructorSkills)
        .where(
          and(
            eq(instructorSkills.courseId, courseId),
            eq(instructorSkills.agentId, agentId),
            eq(instructorSkills.institutionId, institutionId),
            eq(instructorSkills.isActive, true),
            isNull(instructorSkills.deletedAt),
          ),
        )
        .orderBy(asc(instructorSkills.createdAt))
    : [];

  const courseSkillMd = courseBoundSkills
    .map((s) => s.markdown)
    .filter(Boolean)
    .join('\n\n---\n\n');

  const baseSkillMd = courseSkillMd || (await getSkillMarkdown(agentId, institutionId, agentRole) ?? '');

  // 수강생 전용 스킬 (Student - Skill Mapping)
  const studentSpecificSkills = await db
    .select({ markdown: instructorSkills.markdown })
    .from(studentSkills)
    .innerJoin(instructorSkills, eq(studentSkills.skillId, instructorSkills.id))
    .where(
      and(
        eq(studentSkills.studentId, studentId),
        eq(studentSkills.isActive, true),
        eq(instructorSkills.institutionId, institutionId),
        isNull(instructorSkills.deletedAt)
      )
    );

  const studentSkillMd = studentSpecificSkills
    .map((s) => s.markdown)
    .join('\n\n---\n\n');

  const combinedSkillMd = [baseSkillMd, studentSkillMd].filter(Boolean).join('\n\n### 수강생 맞춤 튜터링 스킬 (우선 적용)\n');

  // ── 오케스트레이터: 위임 가능한 에이전트 capabilities 주입 ─────────────
  // 오케스트레이터 역할의 에이전트가 다른 에이전트에게 작업을 위임할 수 있도록
  // 동료 에이전트의 역량(capabilities) 설명을 시스템 프롬프트에 포함합니다.
  let capabilitiesCtx = '';
  if (agentRole === 'orchestrator') {
    capabilitiesCtx = await buildCapabilitiesContext(institutionId, agentId);
  }

  const systemPromptParts = [combinedSkillMd, capabilitiesCtx].filter(Boolean);
  const systemPrompt = buildSystemPrompt(ragResults, systemPromptParts.join('\n\n---\n\n'));

  // ── 4. 대화 이력 로드 ────────────────────────────────────────────────
  // [보안 Fix #1] sessionId + studentId 복합 조건으로 본인 세션만 조회
  // → 타인의 sessionId를 파라미터로 전송해도 빈 배열이 반환되어 컨텍스트 오염 원천 차단
  const historyWhere = and(
    eq(conversationMessages.sessionId, sessionId),
    eq(conversationMessages.studentId, studentId),
  );

  const history = await db
    .select({
      role: conversationMessages.role,
      content: conversationMessages.content,
      turnIndex: conversationMessages.turnIndex,
    })
    .from(conversationMessages)
    .where(historyWhere)
    .orderBy(asc(conversationMessages.turnIndex))
    .limit(MAX_HISTORY_TURNS * 2); // user + assistant 쌍

  // [동시성 Fix #3] DB에 저장된 마지막 turnIndex 기반으로 다음 인덱스 결정
  // → history.length 대신 실제 저장된 최대값을 사용하여 동시 요청 시 충돌 방지
  const [lastTurnRow] = await db
    .select({ turnIndex: conversationMessages.turnIndex })
    .from(conversationMessages)
    .where(eq(conversationMessages.sessionId, sessionId))
    .orderBy(desc(conversationMessages.turnIndex))
    .limit(1);

  const nextTurnIndex = lastTurnRow ? lastTurnRow.turnIndex + 1 : 0;

  // ── 5. LLM 메시지 배열 구성 ──────────────────────────────────────────
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    // 이전 대화 이력 삽입 (system 메시지는 history에 포함 안 함)
    ...history
      .filter((h) => h.role === 'user' || h.role === 'assistant')
      .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    // 현재 질문
    { role: 'user', content: question },
  ];

  // ── 6. 수강생 질문을 LLM 호출 전에 먼저 저장 ────────────────────────
  // [데이터 통전성 Fix #2] LLM이 실패해도 수강생의 질문 이력은 보존됨
  // → 나중에 관리자가 실패한 세션을 확인하거나 재처리할 수 있는 기반 데이터 확보
  await db.insert(conversationMessages).values({
    sessionId,
    role: 'user',
    studentId: studentId ?? undefined, // null이면 DB null (FK 없이 저장)
    agentId,
    courseId,
    content: question,
    turnIndex: nextTurnIndex,
  });

  // ── 7. LLM 호출 ──────────────────────────────────────────────────────
  const llmResponse = await llm.chat(messages);

  // ── 8. AI 응답 저장 ───────────────────────────────────────────────────
  const ragSourcesJson = ragResults.map((r) => ({
    sourceFileName: r.sourceFileName,
    chunkIndex: r.chunkIndex,
    pageNumber: r.pageNumber,
    distance: r.distance,
  }));

  await db.insert(conversationMessages).values({
    sessionId,
    role: 'assistant',
    agentId,
    courseId,
    content: llmResponse.content,
    ragSourcesJson,
    llmMetaJson: {
      model: llmResponse.model,
      inputTokens: llmResponse.inputTokens,
      outputTokens: llmResponse.outputTokens,
    },
    turnIndex: nextTurnIndex + 1,
  });

  // ── 9. 비용 이벤트 기록 (fire-and-forget) ────────────────────────────
  void recordCostEvent({
    institutionId,
    agentId,
    provider: adapterConfig.provider,
    model: llmResponse.model,
    inputTokens: llmResponse.inputTokens,
    outputTokens: llmResponse.outputTokens,
  });

  return {
    sessionId,
    answer: llmResponse.content,
    ragSourceCount: ragResults.length,
    model: llmResponse.model,
    inputTokens: llmResponse.inputTokens,
    outputTokens: llmResponse.outputTokens,
  };
}

// ── 세션 이력 조회 ────────────────────────────────────────────────────────
export async function getChatHistory(sessionId: string, studentId: string) {
  return db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      content: conversationMessages.content,
      ragSourcesJson: conversationMessages.ragSourcesJson,
      turnIndex: conversationMessages.turnIndex,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.sessionId, sessionId),
        eq(conversationMessages.studentId, studentId),
      ),
    )
    .orderBy(asc(conversationMessages.turnIndex));
}
