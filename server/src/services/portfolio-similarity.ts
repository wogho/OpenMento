/**
 * portfolio-similarity.ts — 포트폴리오 유사도 분석 엔진 (Phase 4-2)
 *
 * 흐름:
 *   1. 수강생 기획서 텍스트 → OpenAI 임베딩 생성
 *   2. portfolio_projects(수료생 기준 프로젝트)와 pgvector cosine 검색
 *   3. 최고 유사도 점수 기준 판정(verdict) 결정
 *   4. 판정에 따라 LLM 차별화 제안 생성 (소크라테스식 vs 직접 제안)
 *   5. portfolio_similarity_logs에 이력 저장
 *   6. portfolio_projects.embedding + similarityScore 업데이트
 *
 * 판정 기준:
 *   ≥ 85%  差別化 必要 (differentiation_required)  → 차별화 요소 3개 직접 제안
 *   60~85% 개선 권장 (improvement_recommended)     → 소크라테스식 질문 유도
 *   < 60%  독창성 충족 (originality_confirmed)      → 축하 + 다음 단계 안내
 */

import {
  db,
  portfolioProjects,
  portfolioSimilarityLogs,
  eq,
  isNull,
  and,
  sql,
} from '@educlip/db';
import { embedText, embedBatch } from '@educlip/rag';
import { createAdapterWithFallback } from '../adapters/index.js';
import type { LlmMessage } from '../adapters/index.js';

// ── 상수 ────────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD_CRITICAL = 0.85;   // 이상: 차별화 필수
const DEFAULT_THRESHOLD_WARNING  = 0.60;   // 이상: 개선 권장 (미만: 독창성 충족)

const DEFAULT_PRIMARY  = { provider: 'openai'    as const, model: 'gpt-4o'         };
const DEFAULT_FALLBACK = { provider: 'anthropic' as const, model: 'claude-sonnet-4-5' };

// ────────────────────────────────────────────────────────────────────────────
// 공개 타입
// ────────────────────────────────────────────────────────────────────────────

export type SimilarityVerdict =
  | 'differentiation_required'
  | 'improvement_recommended'
  | 'originality_confirmed';

export type FeedbackStyle = 'socratic' | 'direct';

export interface AnalyzeOptions {
  /** 분석할 수강생 포트폴리오 프로젝트 ID */
  projectId: string;
  /** 기획서 텍스트 (기획 초안 + 기술 스택 등 모두 포함) */
  proposalText: string;
  /** 유사도 기준 슬라이더가 바꾸는 임계치 (default: plan.md 기준) */
  thresholdCritical?: number;
  thresholdWarning?: number;
  /** 차별화 피드백 스타일 (default: 'direct') */
  feedbackStyle?: FeedbackStyle;
  /** 비교 범위: 'all'이면 전기수 포함, 'current_cohort'면 현 기수만 */
  compareScope?: 'all' | 'current_cohort';
  /** 현 기수 course_id (compareScope='current_cohort' 일 때 필수) */
  courseId?: string;
  /** 기관 id (비교 대상을 기관 내 수료생으로 한정) */
  institutionId: string;
}

export interface SimilarityResult {
  projectId: string;
  topSimilarity: number;          // 0~1 (가장 유사한 프로젝트의 cosine 유사도)
  verdict: SimilarityVerdict;
  feedbackText: string;
  comparedProjectId: string | null;
  logId: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 메인 함수
// ────────────────────────────────────────────────────────────────────────────

/**
 * 포트폴리오 유사도 분석 실행.
 * - 임베딩 생성 → pgvector 검색 → 판정 → LLM 피드백 → DB 저장
 */
export async function analyzePortfolioSimilarity(
  options: AnalyzeOptions,
): Promise<SimilarityResult> {
  const {
    projectId,
    proposalText,
    thresholdCritical = DEFAULT_THRESHOLD_CRITICAL,
    thresholdWarning  = DEFAULT_THRESHOLD_WARNING,
    feedbackStyle     = 'direct',
    institutionId,
  } = options;

  // 1. 기획서 임베딩 생성
  const embedding = await embedText(proposalText);

  // 2. portfolio_projects에서 비교 대상 검색
  //    - 본인 프로젝트 제외
  //    - 승인된(approved) 수료생 프로젝트만 비교
  //    - 임베딩이 있는 것만 (seed 데이터 포함)
  //    - cosine_distance 기준 상위 1개 (최대 유사도)
  //
  // ✅ 개선①: 벡터를 드라이버 파라미터($1::vector)로 바인딩하여 30KB 리터럴 인라인 방지.
  // sql 템플릿 태그는 ${} 보간값을 자동으로 파라미터 바인딩하므로,
  // CTE 형태로 벡터를 한 번만 선언해 ORDER BY/SELECT 양쪽에서 재사용합니다.
  const vectorParam = `[${embedding.join(',')}]`;

  const rows = await db.execute(sql`
    WITH query_vec AS (
      SELECT ${vectorParam}::vector AS v
    )
    SELECT
      pp.id,
      1 - (pp.embedding <=> qv.v) AS similarity
    FROM portfolio_projects pp, query_vec qv
    WHERE
      pp.id <> ${projectId}
      AND pp.institution_id = ${institutionId}
      AND pp.status = 'approved'
      AND pp.embedding IS NOT NULL
      AND pp.deleted_at IS NULL
    ORDER BY pp.embedding <=> qv.v
    LIMIT 1
  `);

  const topRow = rows.rows[0] as { id: string; similarity: number } | undefined;
  const topSimilarity = topRow ? Number(topRow.similarity) : 0;
  const comparedProjectId = topRow?.id ?? null;

  // 3. 판정
  const verdict = determineVerdict(topSimilarity, thresholdCritical, thresholdWarning);

  // 4. LLM 차별화 피드백 생성
  const feedbackText = await generateFeedback({
    proposalText,
    topSimilarity,
    verdict,
    feedbackStyle,
  });

  // 5. portfolio_similarity_logs 저장
  const [logRow] = await db
    .insert(portfolioSimilarityLogs)
    .values({
      sourceProjectId: projectId,
      compareProjectId: comparedProjectId,
      similarityScore: topSimilarity,
      verdict,
      feedbackText,
    })
    .returning({ id: portfolioSimilarityLogs.id });

  // 6. portfolio_projects embedding + similarityScore 업데이트
  await db
    .update(portfolioProjects)
    .set({
      embedding: embedding as unknown as undefined,
      similarityScore: topSimilarity,
      updatedAt: new Date(),
    })
    .where(eq(portfolioProjects.id, projectId));

  return {
    projectId,
    topSimilarity,
    verdict,
    feedbackText,
    comparedProjectId,
    logId: logRow.id,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 헬퍼: 판정
// ────────────────────────────────────────────────────────────────────────────

export function determineVerdict(
  score: number,
  thresholdCritical: number,
  thresholdWarning: number,
): SimilarityVerdict {
  if (score >= thresholdCritical) return 'differentiation_required';
  if (score >= thresholdWarning)  return 'improvement_recommended';
  return 'originality_confirmed';
}

// ────────────────────────────────────────────────────────────────────────────
// 헬퍼: LLM 피드백 생성
// ────────────────────────────────────────────────────────────────────────────

interface FeedbackOptions {
  proposalText: string;
  topSimilarity: number;
  verdict: SimilarityVerdict;
  feedbackStyle: FeedbackStyle;
}

async function generateFeedback(opts: FeedbackOptions): Promise<string> {
  const { proposalText, topSimilarity, verdict, feedbackStyle } = opts;

  const scorePercent = Math.round(topSimilarity * 100);

  let systemPrompt: string;
  let userPrompt: string;

  if (verdict === 'originality_confirmed') {
    // 독창성 충족 — 짧은 축하 메시지, LLM 불필요
    return (
      `✅ 독창성 충족 (유사도 ${scorePercent}%)\n\n` +
      `기획서가 역대 수료생 프로젝트와 충분히 차별화되어 있습니다. ` +
      `다음 단계(최종 승인)로 진행할 수 있습니다.`
    );
  }

  if (feedbackStyle === 'socratic') {
    // 소크라테스식 — 질문으로 사고 유도
    systemPrompt =
      '당신은 포트폴리오 멘토입니다. ' +
      '수강생에게 직접 답을 주지 않고, 소크라테스식 질문을 통해 ' +
      '스스로 차별화 아이디어를 발견하도록 유도합니다. ' +
      '질문은 3개 이내로 간결하게 작성하세요.';

    // ✅ 개선②: gpt-4o·claude-sonnet-4-5는 128k+ 컨텍스트 지원 → 600자에서 8000자로 확장
    if (verdict === 'differentiation_required') {
      userPrompt =
        `수강생의 포트폴리오 기획서가 역대 프로젝트와 ${scorePercent}% 유사합니다.\n` +
        `질문을 통해 차별화 방향을 스스로 찾도록 도와주세요.\n\n` +
        `[기획서 전문]\n${proposalText.slice(0, 8000)}`;
    } else {
      userPrompt =
        `수강생의 포트폴리오 기획서가 역대 프로젝트와 ${scorePercent}% 유사합니다. ` +
        `일부 개선이 필요합니다.\n` +
        `질문으로 개선 방향을 함께 탐색해 주세요.\n\n` +
        `[기획서 전문]\n${proposalText.slice(0, 8000)}`;
    }
  } else {
    // 직접 제안 — 차별화 요소 3개 명시
    systemPrompt =
      '당신은 포트폴리오 심사 전문가입니다. ' +
      '수강생의 기획서를 분석하여 구체적인 차별화 요소 3가지를 제안해 주세요. ' +
      '각 제안은 실현 가능하고, 현재 기획서와 명확히 다른 방향이어야 합니다.';

    if (verdict === 'differentiation_required') {
      userPrompt =
        `수강생의 포트폴리오 기획서가 역대 프로젝트와 ${scorePercent}% 유사합니다. ` +
        `차별화가 필수입니다.\n\n` +
        `구체적인 차별화 요소 3가지를 제안해 주세요. ` +
        `각 항목은 "- [차별화 요소]: [구체적인 방법]" 형식으로 작성하세요.\n\n` +
        `[기획서 전문]\n${proposalText.slice(0, 8000)}`;
    } else {
      userPrompt =
        `수강생의 포트폴리오 기획서가 역대 프로젝트와 ${scorePercent}% 유사합니다. ` +
        `일부 개선을 권장합니다.\n\n` +
        `개선 방향 3가지를 제안해 주세요. ` +
        `각 항목은 "- [개선 영역]: [구체적인 방법]" 형식으로 작성하세요.\n\n` +
        `[기획서 전문]\n${proposalText.slice(0, 8000)}`;
    }
  }

  const adapter = createAdapterWithFallback(DEFAULT_PRIMARY, DEFAULT_FALLBACK);
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await adapter.chat(messages, { signal: controller.signal });
    const prefix =
      verdict === 'differentiation_required'
        ? `⚠️ 차별화 필수 (유사도 ${scorePercent}%)\n\n`
        : `💡 개선 권장 (유사도 ${scorePercent}%)\n\n`;
    return prefix + response.content;
  } finally {
    clearTimeout(timeout);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 시드: 수료생 기존 프로젝트 벡터 DB 구축
// ────────────────────────────────────────────────────────────────────────────

/**
 * 역대 수료생 샘플 포트폴리오를 임베딩하여 DB에 저장합니다.
 * - 이미 embedding이 있는 프로젝트는 건너뜁니다.
 * - CI 환경(OPENAI_API_KEY 없음)에서는 실행하지 않습니다.
 */
export async function seedGraduatePortfolios(): Promise<{ seeded: number; skipped: number }> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[PortfolioSimilarity] OPENAI_API_KEY 없음 — 시드 건너뜀');
    return { seeded: 0, skipped: 0 };
  }

  // embedding이 없는 approved 프로젝트 조회
  const rows = await db
    .select({
      id: portfolioProjects.id,
      proposalText: portfolioProjects.proposalText,
      techStack: portfolioProjects.techStack,
    })
    .from(portfolioProjects)
    .where(
      and(
        eq(portfolioProjects.status, 'approved'),
        isNull(portfolioProjects.embedding as unknown as null),
        isNull(portfolioProjects.deletedAt),
      ),
    );

  // ✅ 개선③: FOR 루프 개별 embedText() 대신 embedBatch()로 한 번에 처리.
  // OpenAI API Rate Limit을 배치 단위로 효율적으로 사용하고 네트워크 RTT를 절감합니다.
  const validRows = rows.filter((r) => !!r.proposalText);
  const skipped   = rows.length - validRows.length;

  if (validRows.length === 0) return { seeded: 0, skipped };

  const texts = validRows.map((r) =>
    [r.proposalText, r.techStack].filter(Boolean).join('\n'),
  );

  const embeddings = await embedBatch(texts);

  const updatedAt = new Date();
  await Promise.all(
    validRows.map((row, i) =>
      db
        .update(portfolioProjects)
        .set({ embedding: embeddings[i] as unknown as undefined, updatedAt })
        .where(eq(portfolioProjects.id, row.id)),
    ),
  );

  return { seeded: validRows.length, skipped };
}
