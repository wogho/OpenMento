/**
 * github-code-review.ts — GitHub push/PR 이벤트 기반 AI 코드 리뷰 서비스
 *
 * plan.md Phase 2-5: GitHub Webhook 기반 Proactive Interaction
 *
 * ── 플로우 ─────────────────────────────────────────────────────────────────
 *
 *   1. GitHub Webhook → POST /webhook/github 수신 (HMAC-SHA256 검증)
 *   2. webhookEvent 타입(push/pull_request)으로 routine_triggers 매칭
 *   3. 매칭된 routine 의 agentId(ai_instructor role)로 커밋 diff 분석
 *   4. 코드 리뷰 응답을 conversation_messages 에 저장
 *   5. Socket.io 해당 수강생 Room에 코드 리뷰 알림 Push
 *
 * ── 보안 ────────────────────────────────────────────────────────────────────
 *
 *   - HMAC-SHA256 서명 검증은 routes/webhook.ts 레이어에서 처리
 *   - 이 서비스는 검증 완료된 페이로드만 수신
 *
 * ── LLM 전략 ────────────────────────────────────────────────────────────────
 *
 *   - DB의 ai_instructor 에이전트 adapterConfig 사용
 *   - 설정 없으면 오류 반환 (코드 리뷰는 템플릿 폴백 부적합)
 */

import { z } from 'zod';
import { db, agents, conversationMessages, eq, and, isNull } from '@educlip/db';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { AdapterConfig, LlmMessage } from '../adapters/index.js';
import { logger } from '../utils/logger.js';
import { recordCostEvent } from './budget-guard.js';

// ── Zod 런타임 검증 스키마 ② ────────────────────────────────────────────────

const GitHubCommitSchema = z.object({
  id: z.string(),
  message: z.string(),
  url: z.string().url(),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  modified: z.array(z.string()),
  author: z.object({ name: z.string(), email: z.string() }),
});

export const GitHubPushPayloadSchema = z.object({
  ref: z.string(),
  after: z.string(),
  repository: z.object({
    full_name: z.string(),
    html_url: z.string().url(),
  }),
  pusher: z.object({ name: z.string(), email: z.string() }),
  commits: z.array(GitHubCommitSchema),
  compare: z.string().url(),
});

export const GitHubPrPayloadSchema = z.object({
  action: z.enum(['opened', 'reopened', 'synchronize', 'closed']),
  number: z.number().int().positive(),
  pull_request: z.object({
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string().url(),
    head: z.object({ sha: z.string(), ref: z.string() }),
    base: z.object({ ref: z.string() }),
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    changed_files: z.number().int().min(0),
    diff_url: z.string().url(),
  }),
  repository: z.object({
    full_name: z.string(),
    html_url: z.string().url(),
  }),
  sender: z.object({ login: z.string() }),
});

// ── 타입 (Zod 추론) ──────────────────────────────────────────────────────────

export type GitHubPushPayload = z.infer<typeof GitHubPushPayloadSchema>;
export type GitHubPrPayload = z.infer<typeof GitHubPrPayloadSchema>;

export interface CodeReviewRequest {
  /** 코드 리뷰를 받을 수강생의 userId (JWT sub 또는 studentId) */
  studentId: string;
  /** 수강생의 기관 UUID */
  institutionId: string;
  /** 과목 UUID */
  courseId?: string;
  /** ai_instructor 에이전트 UUID */
  agentId: string;
  /** GitHub 이벤트 타입 */
  eventType: 'push' | 'pull_request';
  /** 분석할 diff 요약 텍스트 */
  diffSummary: string;
  /** 레포 이름 */
  repoFullName: string;
  /** 커밋/PR URL */
  url: string;
}

export interface CodeReviewResult {
  sessionId: string;
  messageId: string;
  review: string;
  model: string;
}

// ── 코드 리뷰 System Prompt ───────────────────────────────────────────────────

function buildCodeReviewSystemPrompt(): string {
  return `당신은 IT 국비지원 교육 과정의 AI 강사입니다.
수강생이 GitHub에 코드를 push했습니다. 커밋 diff를 분석하여 건설적인 코드 리뷰를 제공하세요.

## 코드 리뷰 원칙
1. **소크라테스식 접근**: 정답을 직접 주기보다 개선 방향을 질문으로 유도하세요.
2. **칭찬 먼저**: 잘 한 부분을 먼저 언급한 뒤 개선점을 제시합니다.
3. **구체적 근거**: 막연한 비판 대신 "왜 개선이 필요한지" 설명합니다.
4. **OWASP 보안**: SQL Injection, XSS, 인증/인가 취약점이 보이면 반드시 짚어주세요.
5. **한국어**로 답변하되, 코드 식별자(변수명, 함수명)는 원문 그대로 사용합니다.
6. **200~400자** 분량의 간결한 리뷰를 제공합니다.

## 응답 형식
[ 잘 한 점 ]
...

[ 개선 제안 ]
...

[ 질문 ]
(소크라테스식 유도 질문 1~2개)`;
}

/**
 * push 이벤트에서 diff 요약 텍스트 생성
 */
export function summarizePushPayload(payload: GitHubPushPayload): string {
  const branch = payload.ref.replace('refs/heads/', '');
  const commitLines = payload.commits.slice(0, 5).map((c) => {
    const changes = [
      ...c.added.map((f) => `  + ${f}`),
      ...c.modified.map((f) => `  ~ ${f}`),
      ...c.removed.map((f) => `  - ${f}`),
    ].join('\n');
    return `커밋 ${c.id.slice(0, 7)}: ${c.message}\n${changes}`;
  });

  return `레포지토리: ${payload.repository.full_name}
브랜치: ${branch}
푸셔: ${payload.pusher.name} (${payload.pusher.email})
커밋 수: ${payload.commits.length}개

${commitLines.join('\n\n')}`;
}

/**
 * pull_request 이벤트에서 diff 요약 텍스트 생성
 */
export function summarizePrPayload(payload: GitHubPrPayload): string {
  const pr = payload.pull_request;
  return `레포지토리: ${payload.repository.full_name}
PR #${payload.number}: ${pr.title}
${pr.base.ref} ← ${pr.head.ref}
변경: +${pr.additions} / -${pr.deletions} (${pr.changed_files}개 파일)
설명: ${pr.body ?? '(없음)'}
URL: ${pr.html_url}`;
}

// ── 핵심 함수 ─────────────────────────────────────────────────────────────────

/**
 * 커밋 diff를 분석하여 AI 코드 리뷰를 생성하고 conversation_messages에 저장합니다.
 *
 * @returns 저장된 메시지 정보
 */
export async function generateCodeReview(
  req: CodeReviewRequest,
): Promise<CodeReviewResult> {
  // ── 1. ai_instructor 에이전트 설정 조회 ──────────────────────────────────
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, req.agentId),
        eq(agents.institutionId, req.institutionId),
        eq(agents.isActive, true),
        isNull(agents.deletedAt),
      ),
    );

  if (!agent) {
    throw new Error(`ai_instructor 에이전트를 찾을 수 없습니다. agentId=${req.agentId}`);
  }

  // ── 2. adapterConfig 파싱 ──────────────────────────────────────────────
  const adapterConfig = agent.adapterConfig as AdapterConfig | null;
  const fallbackConfig = agent.fallbackAdapterConfig as AdapterConfig | null;

  if (!adapterConfig) {
    throw new Error('에이전트에 adapterConfig가 설정되지 않았습니다.');
  }

  // ── 3. LLM 호출 ───────────────────────────────────────────────────────
  const adapter = createAdapterWithFallback(adapterConfig, fallbackConfig ?? undefined);
  const systemPrompt = buildCodeReviewSystemPrompt();

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `다음 GitHub ${req.eventType === 'push' ? 'push' : 'Pull Request'} 내용을 분석하고 코드 리뷰를 작성해 주세요.\n\n${req.diffSummary}\n\n리뷰 URL: ${req.url}`,
    },
  ];

  const response = await adapter.chat(messages);

  // ── 4. conversation_messages에 저장 ──────────────────────────────────
  // 코드 리뷰는 별도 세션 UUID를 사용 (AI 강사 → 수강생 방향의 proactive message)
  const sessionId = crypto.randomUUID();
  const reviewContent = `[🔍 GitHub 코드 리뷰 — ${req.repoFullName}]\n\n${response.content}`;

  const [saved] = await db
    .insert(conversationMessages)
    .values({
      sessionId,
      studentId: req.studentId,
      courseId: req.courseId ?? null,
      agentId: req.agentId,
      role: 'assistant',
      content: reviewContent,
      llmMetaJson: {
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        source: 'github_webhook',
        repo: req.repoFullName,
        event: req.eventType,
      },
    })
    .returning({ id: conversationMessages.id });

  if (!saved) {
    throw new Error('conversation_messages 저장 실패');
  }

  logger.info(
    {
      studentId: req.studentId,
      agentId: req.agentId,
      repo: req.repoFullName,
      messageId: saved.id,
      model: response.model,
    },
    '[github-review] 코드 리뷰 생성 완료',
  );

  // ── 5. 비용 이벤트 기록 (fire-and-forget) ────────────────────────────
  void recordCostEvent({
    institutionId: req.institutionId,
    agentId: req.agentId,
    provider: adapterConfig.provider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  return {
    sessionId,
    messageId: saved.id,
    review: reviewContent,
    model: response.model,
  };
}
