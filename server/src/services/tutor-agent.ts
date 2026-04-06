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

import { eq, asc, desc, and, isNull, db, conversationMessages, agents } from '@educlip/db';
import { searchSimilarChunks } from '@educlip/rag';
import { buildSystemPrompt } from './prompts.js';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig, LlmMessage } from '../adapters/index.js';

// ── 타입 ─────────────────────────────────────────────────────────────────
export interface TutorChatOptions {
  /** 대화 세션 UUID. 없으면 신규 세션 UUID를 자동 생성합니다. */
  sessionId?: string;
  /** 수강생 userId (JWT sub) */
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

  const adapterConfig = agent.adapterConfig as AdapterConfig;
  const fallbackConfig = agent.fallbackAdapterConfig as AdapterConfig | null | undefined;

  const llm = createAdapterWithFallback(adapterConfig, fallbackConfig);

  // ── 2. RAG 유사도 검색 (상위 3개 청크) ──────────────────────────────
  const ragResults = await searchSimilarChunks(question, {
    institutionId,
    courseId,
    topK: 3,
  });

  // ── 3. System Prompt 조합 ────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(ragResults);

  // ── 4. 대화 이력 로드 ────────────────────────────────────────────────
  // [보안 Fix #1] sessionId + studentId 복합 조건으로 본인 세션만 조회
  // → 타인의 sessionId를 파라미터로 전송해도 빈 배열이 반환되어 컨텍스트 오염 원천 차단
  const history = await db
    .select({
      role: conversationMessages.role,
      content: conversationMessages.content,
      turnIndex: conversationMessages.turnIndex,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.sessionId, sessionId),
        eq(conversationMessages.studentId, studentId), // 소유권 검증
      ),
    )
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
    studentId,
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
