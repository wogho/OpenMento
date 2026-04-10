/**
 * mental-care-agent.ts — 멘탈케어 에이전트 (공감적 안부 메시지 생성)
 *
 * plan.md Phase 2-4: 멘탈케어 에이전트 구현
 *
 * ── 역할 ─────────────────────────────────────────────────────────────────────
 *
 * EWS 위험 점수가 high_risk(75+) 또는 critical(90+) 수준일 때 자동으로 수강생에게
 * 공감적 어조의 안부 메시지를 한 건 생성하여 conversation_messages 에 저장합니다.
 * 수강생이 다음에 채팅창을 열면 이 메시지를 확인할 수 있습니다.
 *
 * ── LLM 전략 ─────────────────────────────────────────────────────────────────
 *
 * 1. DB에서 기관의 mental_care 에이전트를 조회합니다.
 * 2. 에이전트 설정이 있고 LLM API 키가 process.env에 설정된 경우 LLM 으로 생성합니다.
 * 3. 그렇지 않으면 사전 정의된 공감 메시지 템플릿을 사용합니다.
 *    → 시스템 설정 미완료 상태에서도 안부 메시지 기능이 동작합니다.
 *
 * ── 신뢰성 설계 ─────────────────────────────────────────────────────────────
 *
 * 이 함수는 항상 안전하게 완료됩니다 (LLM 실패 → 템플릿 폴백).
 * caller(slack-notifier.ts)에서 추가로 .catch() 를 감싸므로 예외가 있어도
 * Heartbeat 파이프라인에 영향을 주지 않습니다.
 */

import { db, agents, conversationMessages, eq, and, isNull, desc } from '@openmento/db';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig } from '../adapters/index.js';
import { recordCostEvent } from './budget-guard.js';
import { logger } from '../utils/logger.js';

// ── 공감 메시지 템플릿 풀 ─────────────────────────────────────────────────────
// LLM 설정이 없거나 실패 시 랜덤 선택하여 사용합니다.

const CARE_TEMPLATES = [
  '안녕하세요! 😊 요즘 학습이 어떠신가요? 궁금한 점이 있거나 어려운 부분이 있다면 편하게 질문해 주세요. 저는 언제든지 여기 있을게요!',
  '오늘도 수고 많으셨습니다! 💪 학습 중 막히는 부분이 생기면 망설이지 말고 물어봐 주세요. 함께 해결해 나갈게요.',
  '안녕하세요! 학습 도중 궁금한 점이나 어려움이 있으신가요? 🤔 어떤 질문이든 환영합니다. 여기서 도움드릴 준비가 되어 있어요!',
  '잠깐 쉬어가는 시간을 가져보세요. ☕ 오늘 학습하면서 어떤 부분이 가장 인상 깊었나요? 이야기 나눠보고 싶다면 언제든지 말씀해 주세요!',
  '요즘 교육 과정이 쉽지 않죠? 괜찮아요, 모두가 비슷한 어려움을 겪는답니다. 막히는 부분이 있다면 작은 것이라도 함께 풀어봐요! 🙂',
];

// ── LLM System Prompt (멘탈케어 특화) ────────────────────────────────────────

const MENTAL_CARE_SYSTEM_PROMPT = `당신은 IT 국비지원 교육 과정의 멘탈케어 에이전트입니다.
수강생에게 따뜻하고 공감적인 어조로 짧은 안부 메시지를 건넵니다.

규칙:
- 100자 이내의 짧은 메시지 (1~2문장)
- 공감, 격려, 개방적 질문(학습 상태 점검) 중 하나로 구성
- 수강생의 상황(점수가 낮거나 출결/과제 이슈)을 직접 언급하지 마세요 — 자연스럽게 체크인
- 이모지 1~2개 허용
- 한국어로만 답변`;

function pickRandomTemplate(): string {
  return CARE_TEMPLATES[Math.floor(Math.random() * CARE_TEMPLATES.length)] ?? CARE_TEMPLATES[0]!;
}

// ── 핵심 함수 ────────────────────────────────────────────────────────────────

/**
 * 수강생에게 멘탈케어 안부 메시지를 생성하여 conversation_messages 에 저장합니다.
 *
 * @param institutionId  기관 UUID
 * @param studentId      수강생 UUID
 * @param courseId       과목 UUID
 * @param riskScore      현재 EWS 위험 점수 (LLM 프롬프트 컨텍스트용 — 메시지에 노출 안 함)
 */
export async function sendMentalCareMessage(
  institutionId: string,
  studentId: string,
  courseId: string,
  riskScore: number,
): Promise<void> {
  // ── 1. 기관의 mental_care 에이전트 조회 ──────────────────────────────
  const [careAgent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.institutionId, institutionId),
        eq(agents.role, 'mental_care'),
        eq(agents.isActive, true),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);

  // ── 2. 메시지 생성 (LLM 시도 → 템플릿 폴백) ─────────────────────────
  let message = pickRandomTemplate();
  let llmMetaJson: object | null = null;
  const agentId: string | null = careAgent?.id ?? null;

  if (careAgent) {
    const adapterConfig = careAgent.adapterConfig as AdapterConfig;

    // API 키 존재 여부 확인 (빈 키로 LLM 호출하면 비용 낭비 방지)
    const hasApiKey =
      (adapterConfig.provider === 'openai' && !!process.env['OPENAI_API_KEY']?.trim()) ||
      (adapterConfig.provider === 'anthropic' && !!process.env['ANTHROPIC_API_KEY']?.trim());

    if (hasApiKey) {
      try {
        const fallbackConfig = careAgent.fallbackAdapterConfig as AdapterConfig | null | undefined;
        const llm = createAdapterWithFallback(adapterConfig, fallbackConfig ?? undefined);

        const prompt =
          `수강생 위험 점수: ${riskScore}/100\n` +
          `안부 메시지를 작성해 주세요. (점수 자체는 언급하지 마세요)`;

        const messages = [{ role: "system" as const, content: MENTAL_CARE_SYSTEM_PROMPT }, { role: "user" as const, content: prompt }];
        const result = await llm.chat(messages);

        if (result.content?.trim()) {
          message = result.content.trim();
          llmMetaJson = {
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          };
          // 비용 이벤트 기록 (fire-and-forget)
          void recordCostEvent({
            institutionId,
            agentId: careAgent.id,
            provider: adapterConfig.provider,
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          });
        }
      } catch (err) {
        // LLM 실패 → 템플릿 계속 사용 (이미 pickRandomTemplate() 로 설정됨)
        logger.warn({ err }, '[mental-care-agent] LLM 생성 실패, 템플릿 사용');
      }
    }
  }

  // ── 3. 기존 세션 재사용 또는 신규 세션 UUID 생성 ─────────────────────
  // 가장 최근 대화 세션을 재사용 (자연스러운 채팅 흐름 유지)
  const [lastMsg] = await db
    .select({ sessionId: conversationMessages.sessionId })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.studentId, studentId),
        eq(conversationMessages.courseId, courseId),
      ),
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);

  const sessionId = lastMsg?.sessionId ?? crypto.randomUUID();

  // ── 4. 현재 세션의 마지막 turnIndex 계산 ────────────────────────────
  const [lastTurn] = await db
    .select({ turnIndex: conversationMessages.turnIndex })
    .from(conversationMessages)
    .where(eq(conversationMessages.sessionId, sessionId))
    .orderBy(desc(conversationMessages.turnIndex))
    .limit(1);

  const nextTurnIndex = (lastTurn?.turnIndex ?? -1) + 1;

  // ── 5. conversation_messages 에 저장 ────────────────────────────────
  await db.insert(conversationMessages).values({
    sessionId,
    role: 'assistant',
    studentId,
    agentId,
    courseId,
    content: message,
    turnIndex: nextTurnIndex,
    llmMetaJson: llmMetaJson ?? undefined,
  });

  logger.info(
    `[mental-care-agent] 안부 메시지 저장 완료 — ` +
    `studentId=${studentId.slice(0, 8)}… score=${riskScore} ` +
    `method=${llmMetaJson ? 'llm' : 'template'}`,
  );
}
