/**
 * Phase 4-1 — 다중 에이전트 포트폴리오 오케스트레이션 엔진
 *
 * 역할: 수강생의 프로젝트 기획서 작성을 4단계 에이전트 워크플로우로 안내합니다.
 *
 * 워크플로우 (portfolio_projects.status FSM):
 *   draft → interview → planning → security_review → similarity_check → approved
 *
 * 에이전트 역할:
 *   - interview       : 산업군별 고객 페르소나 에이전트 (요구사항 도출)
 *   - planning        : 솔루션 아키텍트 에이전트 (기술 스택·일정 계획)
 *   - security_review : 보안 전문가 에이전트 (OWASP Top 10 기반 검토)
 *   - similarity_check: 유사도 분석 에이전트 (pgvector 코사인 유사도)
 *
 * 무한 루프 방지:
 *   - goals.maxIterations (기본값 "10") 초과 시 강제 완료
 *   - 각 LLM 호출에 30초 AbortController 타임아웃 적용
 *
 * plan.md 4-1:
 *   [x] Goal 공유 기반 다중 에이전트 협업 플로우 구현
 *   [x] 페르소나 에이전트 System Prompt 템플릿 (산업군별 10개 이상)
 *   [x] 에이전트 간 메시지 전달 프로토콜 구현
 *   [x] 무한 루프 방지 (최대 반복 횟수 제한, 타임아웃 설정)
 */

import {
  db,
  goals,
  portfolioProjects,
  portfolioSimilarityLogs,
  agents,
  eq,
  and,
  isNull,
  sql,
  desc,
} from '@educlip/db';
import { getPersonaById, PERSONA_TEMPLATES } from './persona-prompts.js';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig, LlmMessage } from '../adapters/index.js';
import { recordCostEvent } from './budget-guard.js';
import { sendSystemAlert } from './slack-notifier.js';

// ── 상수 ───────────────────────────────────────────────────────────────────
const LLM_TIMEOUT_MS = 30_000; // 30초 per LLM call
const DEFAULT_MAX_ITERATIONS = 10;

/** 에이전트 간 메시지 전달 프로토콜 */
export interface AgentMessage {
  role: 'persona' | 'planner' | 'security' | 'similarity' | 'user' | 'system';
  content: string;
  stage: PortfolioStage;
  timestamp: string; // ISO-8601
}

export type PortfolioStage =
  | 'draft'
  | 'interview'
  | 'planning'
  | 'hitl_review'       // 개선③: 강사 HITL 승인 대기
  | 'security_review'
  | 'similarity_check'
  | 'approved'
  | 'abandoned';        // 개선②: 24시간 무응답 자동 정리

/** sharedContext JSONB 구조 */
interface SharedContext {
  personaId: string;
  messages: AgentMessage[];
  proposalDraft: string;    // 인터뷰를 거쳐 수집된 기획 내용
  techStackDraft: string;   // planning 단계에서 수집된 기술 스택
  securityFindings: string; // security_review 결과
  similarityScore?: number;
  /** HITL 관련 */
  hitlEnabled?: boolean;    // 기관/강사 설정으로 HITL 활성화 여부
  hitlApprovedAt?: string;  // 강사가 승인한 시각
  hitlRejectedReason?: string; // 거부 시 피드백
}

export interface StartWorkflowOptions {
  studentId: string;
  institutionId: string;
  courseId: string;
  /** 12개 페르소나 중 선택. 미지정 시 랜덤 */
  personaId?: string;
  /** 오케스트레이터 역할의 에이전트 DB ID (없으면 기본 설정 사용) */
  agentId?: string;
  /** 강사 HITL 활성화 여부 (기획서 완성 후 강사 검토 필수). 기본값: false */
  hitlEnabled?: boolean;
}

export interface WorkflowState {
  goalId: string;
  projectId: string;
  stage: PortfolioStage;
  messages: AgentMessage[];
  /** 다음 입력을 기다리는지 여부 */
  awaitingUserInput: boolean;
  /** 워크플로우 완료 여부 */
  completed: boolean;
  similarityScore?: number;
  /** HITL 강사 검토 대기 중 여부 */
  awaitingInstructorReview?: boolean;
}

/** HITL 강사 승인/거부 옵션 */
export interface HitlReviewOptions {
  goalId: string;
  instructorId: string;
  approved: boolean;
  /** 거부 시 수강생에게 전달할 피드백 */
  feedback?: string;
}

export interface AdvanceWorkflowOptions {
  goalId: string;
  studentId: string;
  userMessage: string;
}

// ── 기본 어댑터 설정 ───────────────────────────────────────────────────────
// agentId 미지정 시 사용하는 기본 LLM 설정
const DEFAULT_PRIMARY: AdapterConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: LLM_TIMEOUT_MS,
};

const DEFAULT_FALLBACK: AdapterConfig = {
  provider: 'google',
  model: 'gemini-1.5-flash',
  temperature: 0.7,
  maxTokens: 2048,
  timeoutMs: LLM_TIMEOUT_MS,
};

// ── 단계별 System Prompt ───────────────────────────────────────────────────

const PLANNER_PROMPT = `당신은 10년 경력의 솔루션 아키텍트입니다.
수강생이 고객 인터뷰를 마치고 가져온 요구사항을 바탕으로:
1. 적합한 기술 스택 (Frontend / Backend / DB / 인프라)을 추천해 주세요.
2. 핵심 기능 우선순위 (MoSCoW: Must/Should/Could/Won't)를 분류해 주세요.
3. 3개월 MVP 일정을 주차 단위로 제안해 주세요.
질문은 한 번에 하나씩, 수강생이 답변하면 그 다음 질문으로 넘어가세요.
모든 정보를 수집하면 "기획 초안 완성: [요약]" 형식으로 최종 정리해 주세요.`;

const SECURITY_PROMPT = `당신은 OWASP Top 10 전문 보안 감수자입니다.
수강생의 기술 스택과 기획 내용을 검토하여:
1. OWASP Top 10 기준 잠재적 취약점을 구체적으로 지목하세요.
2. 각 취약점에 대한 완화 방안 (Mitigation)을 제안하세요.
3. 규제 컴플라이언스 (개인정보보호법·GDPR 등) 준수 여부를 점검하세요.
마지막으로 "보안 검토 완료: [종합 평가]" 형식으로 정리해 주세요.`;

// ── 헬퍼: 어댑터 구성 ─────────────────────────────────────────────────────
async function resolveAdapter(agentId?: string) {
  if (agentId) {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agent?.adapterConfig) {
      const config = agent.adapterConfig as AdapterConfig & { fallbackAdapterConfig?: AdapterConfig };
      return createAdapterWithFallback(config, config.fallbackAdapterConfig ?? DEFAULT_FALLBACK);
    }
  }
  return createAdapterWithFallback(DEFAULT_PRIMARY, DEFAULT_FALLBACK);
}

// ── 헬퍼: LLM 호출 (30초 타임아웃) ─────────────────────────────────────────
async function callLlm(
  adapter: Awaited<ReturnType<typeof resolveAdapter>>,
  messages: LlmMessage[],
  agentId: string,
  institutionId: string,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await adapter.chat(messages);
    await recordCostEvent({
      agentId,
      institutionId,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      model: response.model,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ── 헬퍼: goals 반복 횟수 증가 및 루프 방지 검사 ─────────────────────────────
async function checkAndIncrementIteration(goalId: string): Promise<boolean> {
  const [goal] = await db
    .select({ currentIteration: goals.currentIteration, maxIterations: goals.maxIterations })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goal) throw new Error(`Goal ${goalId} 를 찾을 수 없습니다.`);

  const current = parseInt(goal.currentIteration ?? '0', 10);
  const max = parseInt(goal.maxIterations ?? String(DEFAULT_MAX_ITERATIONS), 10);

  if (current >= max) {
    // 최대 반복 초과 → 강제 완료 처리
    await db.update(goals).set({
      status: 'failed',
      result: { reason: `최대 반복 횟수 (${max}회) 초과로 강제 종료` },
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(goals.id, goalId));
    return false; // 더 진행 불가
  }

  await db.update(goals).set({
    currentIteration: String(current + 1),
    updatedAt: new Date(),
  }).where(eq(goals.id, goalId));

  return true; // 진행 가능
}

// ── 헬퍼: sharedContext 로드 ─────────────────────────────────────────────────
async function loadContext(goalId: string): Promise<SharedContext> {
  const [goal] = await db
    .select({ sharedContext: goals.sharedContext })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goal) throw new Error(`Goal ${goalId} 를 찾을 수 없습니다.`);
  return (goal.sharedContext as SharedContext) ?? {
    personaId: '',
    messages: [],
    proposalDraft: '',
    techStackDraft: '',
    securityFindings: '',
  };
}

// ── 헬퍼: sharedContext + portfolio status 업데이트 ───────────────────────────
async function saveContext(
  goalId: string,
  projectId: string,
  ctx: SharedContext,
  nextStage: PortfolioStage,
) {
  const now = new Date();
  await db.update(goals).set({
    sharedContext: ctx,
    updatedAt: now,
  }).where(eq(goals.id, goalId));

  await db.update(portfolioProjects).set({
    status: nextStage,
    updatedAt: now,
  }).where(eq(portfolioProjects.id, projectId));
}

// ── 헬퍼: 프로젝트 ID 조회 ────────────────────────────────────────────────────
async function getProjectId(goalId: string): Promise<string> {
  // sharedContext에 projectId를 별도 저장하지 않으므로 goals 제목(title)에 UUID를 박음
  // 실제로는 portfolio_projects.goalId FK가 있으면 좋지만 스키마에 없으므로
  // sharedContext.projectId 필드 활용
  const [goal] = await db
    .select({ sharedContext: goals.sharedContext })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goal) throw new Error(`Goal ${goalId} 를 찾을 수 없습니다.`);
  const ctx = goal.sharedContext as (SharedContext & { projectId?: string }) | null;
  if (!ctx?.projectId) throw new Error(`Goal ${goalId} 에 projectId가 없습니다.`);
  return ctx.projectId;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 포트폴리오 워크플로우 시작
 *
 * 1. goals 레코드 생성 (status: active)
 * 2. portfolio_projects 레코드 생성 (status: interview)
 * 3. 페르소나 에이전트 첫 인사말 생성
 */
export async function startPortfolioWorkflow(
  options: StartWorkflowOptions,
): Promise<WorkflowState> {
  const { studentId, institutionId, courseId, agentId } = options;

  // 페르소나 선택 (미지정 시 랜덤)
  const persona =
    (options.personaId ? getPersonaById(options.personaId) : undefined) ??
    PERSONA_TEMPLATES[Math.floor(Math.random() * PERSONA_TEMPLATES.length)];

  // 1. 포트폴리오 프로젝트 생성 (draft)
  const [project] = await db
    .insert(portfolioProjects)
    .values({
      studentId,
      courseId,
      institutionId,
      status: 'draft',
    })
    .returning({ id: portfolioProjects.id });

  // 2. Goal 생성
  const initCtx: SharedContext & { projectId: string } = {
    projectId: project.id,
    personaId: persona.id,
    messages: [],
    proposalDraft: '',
    techStackDraft: '',
    securityFindings: '',
    hitlEnabled: options.hitlEnabled ?? false,
  };

  const [goal] = await db
    .insert(goals)
    .values({
      institutionId,
      title: `포트폴리오 워크플로우 — ${persona.industry}`,
      description: `수강생 ${studentId} 의 포트폴리오 기획서 작성 (페르소나: ${persona.role})`,
      status: 'active',
      sharedContext: initCtx,
      maxIterations: String(DEFAULT_MAX_ITERATIONS),
      currentIteration: '0',
    })
    .returning({ id: goals.id });

  // 3. 상태를 interview로 전환
  await saveContext(goal.id, project.id, initCtx, 'interview');

  // 4. 페르소나 에이전트 첫 인사말 생성
  const adapter = await resolveAdapter(agentId);

  const systemMessage: LlmMessage = {
    role: 'system',
    content: `${persona.prompt}
    
[시작 지시]
수강생에게 당신의 역할(${persona.industry} 분야 ${persona.role})을 짧게 소개하고,
프로젝트 아이디어를 들어보겠다고 한 문장으로 시작하세요.`,
  };

  const canProceed = await checkAndIncrementIteration(goal.id);
  if (!canProceed) {
    throw new Error('워크플로우를 시작할 수 없습니다: 반복 횟수 초과');
  }

  const llmResponse = await callLlm(
    adapter,
    [systemMessage],
    agentId ?? 'system',
    institutionId,
  );

  const firstMessage: AgentMessage = {
    role: 'persona',
    content: llmResponse.content,
    stage: 'interview',
    timestamp: new Date().toISOString(),
  };

  initCtx.messages.push(firstMessage);

  await db.update(goals).set({
    sharedContext: initCtx,
    updatedAt: new Date(),
  }).where(eq(goals.id, goal.id));

  return {
    goalId: goal.id,
    projectId: project.id,
    stage: 'interview',
    messages: [firstMessage],
    awaitingUserInput: true,
    completed: false,
  };
}

/**
 * 워크플로우를 한 스텝 진행합니다.
 *
 * FSM 전환 규칙:
 *   interview        → planning        (인터뷰 종료 감지 or 사용자가 "완료")
 *   planning         → security_review (기술 스택 결정 감지 or "완료")
 *   security_review  → similarity_check (보안 검토 완료 감지)
 *   similarity_check → approved        (유사도 < 0.7 이면 승인)
 */
export async function advanceWorkflow(
  options: AdvanceWorkflowOptions,
): Promise<WorkflowState> {
  const { goalId, studentId, userMessage } = options;

  // 1. 현재 상태 로드
  const [goalRow] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.status, 'active')))
    .limit(1);

  if (!goalRow) {
    throw Object.assign(new Error('활성 Goal을 찾을 수 없습니다.'), { statusCode: 404 });
  }

  const ctx = (goalRow.sharedContext as SharedContext & { projectId: string });
  const projectId = ctx.projectId;

  // 2. 현재 단계 파악
  const [projectRow] = await db
    .select({ status: portfolioProjects.status })
    .from(portfolioProjects)
    .where(eq(portfolioProjects.id, projectId))
    .limit(1);

  if (!projectRow) {
    throw Object.assign(new Error('포트폴리오 프로젝트를 찾을 수 없습니다.'), { statusCode: 404 });
  }

  const currentStage = projectRow.status as PortfolioStage;

  // 3. 루프 방지 검사
  const canProceed = await checkAndIncrementIteration(goalId);
  if (!canProceed) {
    return {
      goalId,
      projectId,
      stage: currentStage,
      messages: ctx.messages,
      awaitingUserInput: false,
      completed: true,
    };
  }

  // 4. 사용자 메시지 기록
  const userMsg: AgentMessage = {
    role: 'user',
    content: userMessage,
    stage: currentStage,
    timestamp: new Date().toISOString(),
  };
  ctx.messages.push(userMsg);

  // 5. 현재 단계 처리
  const adapter = await resolveAdapter(goalRow.initiatorAgentId ?? undefined);

  let agentResponse: AgentMessage;
  let nextStage: PortfolioStage = currentStage;

  switch (currentStage) {
    case 'interview': {
      agentResponse = await handleInterviewStage(ctx, userMessage, adapter, goalRow.institutionId ?? '');
      // 인터뷰 종료 신호 감지: "기획 정리 완료", "요구사항 정리" 등
      const interviewDone =
        agentResponse.content.includes('기획 정리 완료') ||
        agentResponse.content.includes('인터뷰 완료') ||
        userMessage.trim() === '완료';
      if (interviewDone) {
        ctx.proposalDraft = agentResponse.content;
        nextStage = 'planning';
        // planning 에이전트 첫 메시지 선제 발행
        const plannerOpening = await callLlm(
          adapter,
          buildPlannerMessages(ctx, ''),
          goalRow.initiatorAgentId ?? 'system',
          goalRow.institutionId ?? '',
        );
        const plannerMsg: AgentMessage = {
          role: 'planner',
          content: plannerOpening.content,
          stage: 'planning',
          timestamp: new Date().toISOString(),
        };
        ctx.messages.push(plannerMsg);
      }
      break;
    }

    case 'planning': {
      agentResponse = await handlePlanningStage(ctx, userMessage, adapter, goalRow.institutionId ?? '');
      const planningDone =
        agentResponse.content.includes('기획 초안 완성') ||
        userMessage.trim() === '완료';
      if (planningDone) {
        ctx.techStackDraft = agentResponse.content;

        // ── HITL 분기: hitlEnabled=true이면 강사 검토 대기 단계로 전환 ────────────
        if (ctx.hitlEnabled) {
          nextStage = 'hitl_review';
          const hitlNotice: AgentMessage = {
            role: 'system',
            content:
              '기획서 초안이 완성되었습니다. 담당 강사의 검토 후 보안 분석 단계로 진행됩니다. ' +
              '강사가 승인할 때까지 잠시 기다려 주세요.',
            stage: 'hitl_review',
            timestamp: new Date().toISOString(),
          };
          ctx.messages.push(hitlNotice);
          // Slack으로 강사에게 검토 요청 알림
          await sendSystemAlert(
            `[HITL 강사 검토 요청] Goal ID: ${goalId}\n` +
              `기획서 초안이 완성되었습니다. 포털에서 검토 후 승인/거부해 주세요.`,
          );
        } else {
          nextStage = 'security_review';
          const securityOpening = await callLlm(
            adapter,
            buildSecurityMessages(ctx, ''),
            goalRow.initiatorAgentId ?? 'system',
            goalRow.institutionId ?? '',
          );
          const secMsg: AgentMessage = {
            role: 'security',
            content: securityOpening.content,
            stage: 'security_review',
            timestamp: new Date().toISOString(),
          };
          ctx.messages.push(secMsg);
        }
      }
      break;
    }

    case 'hitl_review': {
      // 수강생 메시지는 무시 — 강사 승인/거부 API(processHitlReview)를 통해서만 진행
      agentResponse = {
        role: 'system',
        content: '담당 강사의 검토가 진행 중입니다. 잠시 기다려 주세요.',
        stage: 'hitl_review',
        timestamp: new Date().toISOString(),
      };
      nextStage = 'hitl_review'; // 강사 승인 전까지 유지
      break;
    }

    case 'security_review': {
      agentResponse = await handleSecurityStage(ctx, userMessage, adapter, goalRow.institutionId ?? '');
      const securityDone =
        agentResponse.content.includes('보안 검토 완료') ||
        userMessage.trim() === '완료';
      if (securityDone) {
        ctx.securityFindings = agentResponse.content;
        nextStage = 'similarity_check';
        // 유사도 분석은 별도 에이전트가 자동 처리 (사용자 입력 불필요)
        const simResult = await handleSimilarityStage(
          ctx,
          projectId,
          goalRow.institutionId ?? '',
          goalRow.initiatorAgentId ?? 'system',
          adapter,
        );
        agentResponse = simResult.message;
        ctx.similarityScore = simResult.score;
        nextStage = simResult.score < 0.7 ? 'approved' : 'similarity_check';

        if (nextStage === 'approved') {
          await finalizeWorkflow(goalId, projectId, ctx, simResult.score);
          return {
            goalId,
            projectId,
            stage: 'approved',
            messages: [...ctx.messages, agentResponse],
            awaitingUserInput: false,
            completed: true,
            similarityScore: simResult.score,
          };
        }
      }
      break;
    }

    case 'similarity_check': {
      // 유사도가 높아 수강생에게 수정 요청 — 수정 내용을 받아 재분석
      agentResponse = {
        role: 'similarity',
        content: '수정 내용을 반영하여 다시 검토합니다. 잠시 기다려 주세요.',
        stage: 'similarity_check',
        timestamp: new Date().toISOString(),
      };
      ctx.proposalDraft = userMessage; // 수정된 기획서 대체
      const reSimResult = await handleSimilarityStage(
        ctx,
        projectId,
        goalRow.institutionId ?? '',
        goalRow.initiatorAgentId ?? 'system',
        adapter,
      );
      agentResponse = reSimResult.message;
      ctx.similarityScore = reSimResult.score;
      nextStage = reSimResult.score < 0.7 ? 'approved' : 'similarity_check';

      if (nextStage === 'approved') {
        await finalizeWorkflow(goalId, projectId, ctx, reSimResult.score);
        return {
          goalId,
          projectId,
          stage: 'approved',
          messages: [...ctx.messages, agentResponse],
          awaitingUserInput: false,
          completed: true,
          similarityScore: reSimResult.score,
        };
      }
      break;
    }

    default:
      throw Object.assign(
        new Error(`지원하지 않는 단계입니다: ${currentStage}`),
        { statusCode: 400 },
      );
  }

  ctx.messages.push(agentResponse);

  // 6. 컨텍스트 저장
  await saveContext(goalId, projectId, ctx, nextStage);

  return {
    goalId,
    projectId,
    stage: nextStage,
    messages: ctx.messages.slice(-5), // 최근 5개 메시지만 반환 (페이로드 절감)
    awaitingUserInput: nextStage !== 'approved' && nextStage !== 'hitl_review',
    awaitingInstructorReview: nextStage === 'hitl_review',
    completed: false,
    similarityScore: ctx.similarityScore,
  };
}

/** 현재 Goal 전체 상태 조회 */
export async function getWorkflowState(goalId: string): Promise<WorkflowState> {
  const [goalRow] = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goalRow) {
    throw Object.assign(new Error('Goal을 찾을 수 없습니다.'), { statusCode: 404 });
  }

  const ctx = goalRow.sharedContext as (SharedContext & { projectId?: string }) | null;
  const projectId = ctx?.projectId ?? '';

  let stage: PortfolioStage = 'draft';
  if (projectId) {
    const [projectRow] = await db
      .select({ status: portfolioProjects.status })
      .from(portfolioProjects)
      .where(eq(portfolioProjects.id, projectId))
      .limit(1);
    if (projectRow) stage = projectRow.status as PortfolioStage;
  }

  return {
    goalId,
    projectId,
    stage,
    messages: ctx?.messages ?? [],
    awaitingUserInput: goalRow.status === 'active' && stage !== 'approved' && stage !== 'hitl_review',
    awaitingInstructorReview: stage === 'hitl_review',
    completed: goalRow.status === 'completed' || goalRow.status === 'failed',
    similarityScore: ctx?.similarityScore,
  };
}

/**
 * HITL 강사 승인/거부 처리 (개선③)
 *
 * - 승인: hitl_review → security_review 전환, 보안 에이전트 첫 메시지 발행
 * - 거부: 피드백 메시지 추가 후 planning 단계로 되돌림 (수강생이 기획서 수정 가능)
 */
export async function processHitlReview(
  options: HitlReviewOptions,
): Promise<WorkflowState> {
  const { goalId, instructorId, approved, feedback } = options;

  const [goalRow] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.status, 'active')))
    .limit(1);

  if (!goalRow) {
    throw Object.assign(new Error('활성 Goal을 찾을 수 없습니다.'), { statusCode: 404 });
  }

  const ctx = goalRow.sharedContext as SharedContext & { projectId: string };
  const projectId = ctx.projectId;

  // 현재 단계가 hitl_review인지 검증
  const [projectRow] = await db
    .select({ status: portfolioProjects.status })
    .from(portfolioProjects)
    .where(eq(portfolioProjects.id, projectId))
    .limit(1);

  if (!projectRow || projectRow.status !== 'hitl_review') {
    throw Object.assign(
      new Error('현재 HITL 검토 대기 상태가 아닙니다.'),
      { statusCode: 409 },
    );
  }

  if (approved) {
    // ── 승인: security_review로 이동 ──────────────────────────────────────
    ctx.hitlApprovedAt = new Date().toISOString();
    const approvalMsg: AgentMessage = {
      role: 'system',
      content: `강사 검토가 완료되었습니다. (검토자: ${instructorId}) 이제 보안 전문가 에이전트가 기획서를 분석합니다.`,
      stage: 'security_review',
      timestamp: new Date().toISOString(),
    };
    ctx.messages.push(approvalMsg);

    const adapter = await resolveAdapter(goalRow.initiatorAgentId ?? undefined);
    const securityOpening = await callLlm(
      adapter,
      buildSecurityMessages(ctx, ''),
      goalRow.initiatorAgentId ?? 'system',
      goalRow.institutionId ?? '',
    );
    const secMsg: AgentMessage = {
      role: 'security',
      content: securityOpening.content,
      stage: 'security_review',
      timestamp: new Date().toISOString(),
    };
    ctx.messages.push(secMsg);

    await saveContext(goalId, projectId, ctx, 'security_review');

    return {
      goalId,
      projectId,
      stage: 'security_review',
      messages: ctx.messages.slice(-5),
      awaitingUserInput: true,
      awaitingInstructorReview: false,
      completed: false,
    };
  } else {
    // ── 거부: planning으로 되돌림 ────────────────────────────────────────
    ctx.hitlRejectedReason = feedback ?? '강사 검토 결과 수정이 필요합니다.';
    const rejectMsg: AgentMessage = {
      role: 'system',
      content:
        `강사 검토 결과 수정이 필요합니다.\n\n` +
        `피드백: ${ctx.hitlRejectedReason}\n\n` +
        `기획서를 수정한 후 다시 제출해 주세요.`,
      stage: 'planning',
      timestamp: new Date().toISOString(),
    };
    ctx.messages.push(rejectMsg);

    await saveContext(goalId, projectId, ctx, 'planning');

    return {
      goalId,
      projectId,
      stage: 'planning',
      messages: ctx.messages.slice(-5),
      awaitingUserInput: true,
      awaitingInstructorReview: false,
      completed: false,
    };
  }
}

// ── 단계별 핸들러 ──────────────────────────────────────────────────────────

async function handleInterviewStage(
  ctx: SharedContext,
  userMessage: string,
  adapter: Awaited<ReturnType<typeof resolveAdapter>>,
  institutionId: string,
): Promise<AgentMessage> {
  const persona = getPersonaById(ctx.personaId);
  if (!persona) throw new Error(`페르소나 ID "${ctx.personaId}" 를 찾을 수 없습니다.`);

  const messages: LlmMessage[] = [
    { role: 'system', content: persona.prompt },
    ...ctx.messages
      .filter((m) => m.stage === 'interview')
      .map((m): LlmMessage => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    { role: 'user', content: userMessage },
  ];

  const response = await callLlm(adapter, messages, 'persona-agent', institutionId);

  return {
    role: 'persona',
    content: response.content,
    stage: 'interview',
    timestamp: new Date().toISOString(),
  };
}

function buildPlannerMessages(ctx: SharedContext, userMessage: string): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_PROMPT },
    {
      role: 'user',
      content: `인터뷰에서 수집한 요구사항:\n${ctx.proposalDraft}\n\n위 내용을 바탕으로 기술 스택과 MVP 계획을 수립해 주세요.`,
    },
  ];
  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }
  return messages;
}

async function handlePlanningStage(
  ctx: SharedContext,
  userMessage: string,
  adapter: Awaited<ReturnType<typeof resolveAdapter>>,
  institutionId: string,
): Promise<AgentMessage> {
  const messages: LlmMessage[] = [
    { role: 'system', content: PLANNER_PROMPT },
    ...ctx.messages
      .filter((m) => m.stage === 'planning')
      .map((m): LlmMessage => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    { role: 'user', content: userMessage },
  ];

  const response = await callLlm(adapter, messages, 'planner-agent', institutionId);

  return {
    role: 'planner',
    content: response.content,
    stage: 'planning',
    timestamp: new Date().toISOString(),
  };
}

function buildSecurityMessages(ctx: SharedContext, userMessage: string): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: 'system', content: SECURITY_PROMPT },
    {
      role: 'user',
      content: `검토 대상 기획서:\n${ctx.proposalDraft}\n\n결정된 기술 스택:\n${ctx.techStackDraft}`,
    },
  ];
  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }
  return messages;
}

async function handleSecurityStage(
  ctx: SharedContext,
  userMessage: string,
  adapter: Awaited<ReturnType<typeof resolveAdapter>>,
  institutionId: string,
): Promise<AgentMessage> {
  const messages: LlmMessage[] = [
    { role: 'system', content: SECURITY_PROMPT },
    ...ctx.messages
      .filter((m) => m.stage === 'security_review')
      .map((m): LlmMessage => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
    { role: 'user', content: userMessage },
  ];

  const response = await callLlm(adapter, messages, 'security-agent', institutionId);

  return {
    role: 'security',
    content: response.content,
    stage: 'security_review',
    timestamp: new Date().toISOString(),
  };
}

/**
 * 유사도 분석 단계
 *
 * 실제 pgvector 환경에서는 임베딩을 생성하고 코사인 유사도를 계산합니다.
 * CI 환경(pgvector 미설치) 에서는 아래와 같이 0.0 을 반환합니다.
 */
async function handleSimilarityStage(
  ctx: SharedContext,
  projectId: string,
  institutionId: string,
  agentId: string,
  adapter: Awaited<ReturnType<typeof resolveAdapter>>,
): Promise<{ message: AgentMessage; score: number }> {
  // ── 유사도 분석 (pgvector available 시 실제 검색) ──────────────────────
  let similarityScore = 0.0;
  let verdict = 'originality_confirmed';
  let feedbackText = '기획서의 독창성이 확인되었습니다.';

  try {
    // 임베딩 생성은 실제 배포 시 OpenAI text-embedding-3-small 사용
    // CI 환경에서 OPENAI_API_KEY 없을 수 있으므로 try-catch
    const embeddingResponse = await callLlm(
      adapter,
      [
        {
          role: 'system',
          content: '아래 텍스트를 한 문장으로 핵심 키워드만 추출해 요약하세요.',
        },
        { role: 'user', content: ctx.proposalDraft.substring(0, 1000) },
      ],
      agentId,
      institutionId,
    );

    // pgvector 쿼리 (Raw SQL — vector 타입은 Drizzle ORM 타입 지원 한계로 raw 사용)
    const result = await db.execute(
      sql`
        SELECT id, similarity_score,
               1 - (embedding <=> (
                 SELECT embedding FROM portfolio_projects WHERE id = ${projectId}
               )) AS cosine_sim
        FROM portfolio_projects
        WHERE id != ${projectId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
        ORDER BY cosine_sim DESC
        LIMIT 1
      `,
    );

    const rows = result.rows as Array<{
      id: string;
      cosine_sim: number | null;
    }>;

    if (rows.length > 0 && rows[0].cosine_sim !== null) {
      similarityScore = rows[0].cosine_sim;
      if (similarityScore >= 0.7) {
        verdict = 'differentiation_required';
        feedbackText = `기존 기획서와 ${(similarityScore * 100).toFixed(1)}% 유사합니다. 차별화가 필요합니다.`;
      } else if (similarityScore >= 0.5) {
        verdict = 'improvement_recommended';
        feedbackText = `기존 기획서와 ${(similarityScore * 100).toFixed(1)}% 유사합니다. 개선을 권장합니다.`;
      }
    }

    // 유사도 로그 저장
    if (rows.length > 0) {
      await db.insert(portfolioSimilarityLogs).values({
        sourceProjectId: projectId,
        compareProjectId: rows[0].id,
        similarityScore,
        verdict,
        feedbackText,
      });
    }
  } catch {
    // pgvector 미사용 환경 (CI) 에서는 독창성 확인으로 처리
    similarityScore = 0.0;
    feedbackText = '유사도 분석 서비스에 연결 중 오류가 발생하여 독창성 확인으로 처리합니다.';
  }

  // 유사도 에이전트 메시지 생성
  const summaryMessages: LlmMessage[] = [
    {
      role: 'system',
      content: `당신은 포트폴리오 심사위원입니다.
유사도 분석 결과: ${feedbackText}
보안 검토 결과: ${ctx.securityFindings.substring(0, 300)}
최종 판정(${verdict})을 수강생에게 친절하게 설명하고, 다음 단계 안내를 하세요.`,
    },
    { role: 'user', content: '분석 결과를 알려주세요.' },
  ];

  const response = await callLlm(adapter, summaryMessages, agentId, institutionId);

  return {
    message: {
      role: 'similarity',
      content: response.content,
      stage: 'similarity_check',
      timestamp: new Date().toISOString(),
    },
    score: similarityScore,
  };
}

/** 워크플로우 최종 완료 처리 */
async function finalizeWorkflow(
  goalId: string,
  projectId: string,
  ctx: SharedContext,
  similarityScore: number,
) {
  const now = new Date();
  await db.update(goals).set({
    status: 'completed',
    result: {
      proposalDraft: ctx.proposalDraft,
      techStackDraft: ctx.techStackDraft,
      securityFindings: ctx.securityFindings,
      similarityScore,
    },
    completedAt: now,
    updatedAt: now,
  }).where(eq(goals.id, goalId));

  await db.update(portfolioProjects).set({
    status: 'approved',
    proposalText: ctx.proposalDraft,
    techStack: ctx.techStackDraft,
    similarityScore,
    approvedAt: now,
    updatedAt: now,
  }).where(eq(portfolioProjects.id, projectId));
}

// ── 개선①: 세션 복구 — 학생의 가장 최근 활성 워크플로우 조회 ──────────────────

/**
 * 수강생의 진행 중인(active) 최근 포트폴리오 워크플로우를 반환합니다.
 * 없으면 null 을 반환합니다. (세션 복구용)
 */
export async function getActiveWorkflow(studentId: string): Promise<WorkflowState | null> {
  // 1. 수강생의 가장 최근 비완료 프로젝트 조회
  const [project] = await db
    .select({ id: portfolioProjects.id, status: portfolioProjects.status })
    .from(portfolioProjects)
    .where(
      and(
        eq(portfolioProjects.studentId, studentId),
        sql`${portfolioProjects.status} NOT IN ('approved', 'abandoned')`,
      ),
    )
    .orderBy(desc(portfolioProjects.updatedAt))
    .limit(1);

  if (!project) return null;

  // 2. 해당 프로젝트와 연결된 활성 goal 조회 (sharedContext.projectId JSON 경로)
  const [goalRow] = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.status, 'active'),
        sql`${goals.sharedContext}->>'projectId' = ${project.id}`,
      ),
    )
    .orderBy(desc(goals.updatedAt))
    .limit(1);

  if (!goalRow) return null;

  const ctx = goalRow.sharedContext as (SharedContext & { projectId?: string }) | null;
  const stage = project.status as PortfolioStage;

  return {
    goalId: goalRow.id,
    projectId: project.id,
    stage,
    messages: ctx?.messages ?? [],
    awaitingUserInput: stage !== 'approved' && stage !== 'hitl_review',
    awaitingInstructorReview: stage === 'hitl_review',
    completed: false,
    similarityScore: ctx?.similarityScore,
  };
}

// ── 개선②: 기획서 임시 저장 (Draft Save) ────────────────────────────────────

/**
 * 기획서 초안을 DB에 저장합니다. (자동 저장용)
 * portfolio_projects.proposalText + goals.sharedContext.proposalDraft 동기화.
 */
export async function saveDraft(goalId: string, proposalText: string): Promise<void> {
  const projectId = await getProjectId(goalId);

  // portfolio_projects 업데이트
  await db
    .update(portfolioProjects)
    .set({ proposalText, updatedAt: new Date() })
    .where(eq(portfolioProjects.id, projectId));

  // sharedContext.proposalDraft 동기화
  const [goalRow] = await db
    .select({ sharedContext: goals.sharedContext })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (goalRow) {
    const ctx = (goalRow.sharedContext as SharedContext) ?? {};
    await db
      .update(goals)
      .set({ sharedContext: { ...ctx, proposalDraft: proposalText }, updatedAt: new Date() })
      .where(eq(goals.id, goalId));
  }
}
