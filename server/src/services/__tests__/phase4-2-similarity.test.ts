/**
 * phase4-2-similarity.test.ts — Phase 4-2 포트폴리오 유사도 분석 엔진 DoD 검증
 *
 * ── 검증 항목 ──────────────────────────────────────────────────────────────
 *
 *  [유사도 분석 서비스]
 *  Sim①  analyzePortfolioSimilarity: similarity_logs에 INSERT합니다.
 *  Sim②  similarityScore >= 0.85  → verdict 'differentiation_required'.
 *  Sim③  0.60 <= score < 0.85     → verdict 'improvement_recommended'.
 *  Sim④  score < 0.60             → verdict 'originality_confirmed'.
 *  Sim⑤  feedbackStyle='socratic' → 소크라테스식 프롬프트 사용 (질문 포함).
 *  Sim⑥  feedbackStyle='direct'   → 직접 제안 프롬프트 사용 (차별화 요소 포함).
 *  Sim⑦  비교 프로젝트 없을 때 score=0 → originality_confirmed 처리.
 *  Sim⑧  분석 후 portfolio_projects.embedding, similarityScore 업데이트.
 *
 *  [verdict 헬퍼]
 *  V①  determineVerdict(0.90, 0.85, 0.60) → 'differentiation_required'.
 *  V②  determineVerdict(0.70, 0.85, 0.60) → 'improvement_recommended'.
 *  V③  determineVerdict(0.50, 0.85, 0.60) → 'originality_confirmed'.
 *  V④  determineVerdict(0.85, 0.85, 0.60) → 'differentiation_required' (경계값).
 *  V⑤  determineVerdict(0.60, 0.85, 0.60) → 'improvement_recommended' (경계값).
 *  V⑥  사용자 정의 임계치(0.90, 0.70) 반영.
 *
 *  [수료생 시드]
 *  Seed① seedGraduatePortfolios: OPENAI_API_KEY 없을 때 seeded=0 반환.
 *  Seed② seedGraduatePortfolios: API 키 있을 때 embedding 미보유 프로젝트를 업데이트.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted Mock 변수 ────────────────────────────────────────────────────────

const {
  mockDb,
  mockExecute,
  mockInsertValues,
  mockInsertReturning,
  mockUpdateSet,
  mockUpdateWhere,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mockSelectFrom,
  mockSelectWhere,
  mockEmbedText,
  mockEmbedBatch,
  mockChat,
} = vi.hoisted(() => {
  const mockInsertReturning = vi.fn();
  const mockInsertValues    = vi.fn(() => ({ returning: mockInsertReturning }));
  const mockUpdateWhere     = vi.fn();
  const mockUpdateSet       = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockSelectWhere     = vi.fn();
  const mockSelectFrom      = vi.fn(() => ({ where: mockSelectWhere }));
  const mockExecute         = vi.fn();
  const mockInsert          = vi.fn(() => ({ values: mockInsertValues }));
  const mockUpdate          = vi.fn(() => ({ set: mockUpdateSet }));
  const mockSelect          = vi.fn(() => ({ from: mockSelectFrom }));
  const mockEmbedText       = vi.fn();
  const mockEmbedBatch      = vi.fn();
  const mockChat            = vi.fn();

  const mockDb = {
    execute: mockExecute,
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  };

  return {
    mockDb,
    mockExecute,
    mockInsertValues,
    mockInsertReturning,
    mockUpdateSet,
    mockUpdateWhere,
    mockSelectFrom,
    mockSelectWhere,
    mockEmbedText,
    mockEmbedBatch,
    mockChat,
  };
});

// ── DB Mock ──────────────────────────────────────────────────────────────────

vi.mock('@educlip/db', async () => {
  const actual = await vi.importActual<typeof import('@educlip/db')>('@educlip/db');
  return {
    ...actual,
    db: mockDb,
    eq: actual.eq,
    and: actual.and,
    isNull: actual.isNull,
  };
});

// ── RAG embedder Mock ────────────────────────────────────────────────────────

vi.mock('@educlip/rag', async () => {
  const actual = await vi.importActual<typeof import('@educlip/rag')>('@educlip/rag');
  return {
    ...actual,
    embedText: mockEmbedText,
    embedBatch: mockEmbedBatch,
  };
});

// ── LLM 어댑터 Mock (경로: 테스트 파일 기준 ../../adapters/index.js) ──────────

vi.mock('../../adapters/index.js', () => ({
  createAdapterWithFallback: vi.fn(() => ({ chat: mockChat })),
}));

// ── 테스트 대상 ──────────────────────────────────────────────────────────────

import {
  analyzePortfolioSimilarity,
  determineVerdict,
  seedGraduatePortfolios,
} from '../portfolio-similarity.js';

// ============================
// A. determineVerdict 헬퍼 테스트
// ============================

describe('Phase 4-2: determineVerdict 헬퍼', () => {
  it('V①  0.90 → differentiation_required', () => {
    expect(determineVerdict(0.90, 0.85, 0.60)).toBe('differentiation_required');
  });

  it('V②  0.70 → improvement_recommended', () => {
    expect(determineVerdict(0.70, 0.85, 0.60)).toBe('improvement_recommended');
  });

  it('V③  0.50 → originality_confirmed', () => {
    expect(determineVerdict(0.50, 0.85, 0.60)).toBe('originality_confirmed');
  });

  it('V④  0.85 (경계값) → differentiation_required', () => {
    expect(determineVerdict(0.85, 0.85, 0.60)).toBe('differentiation_required');
  });

  it('V⑤  0.60 (경계값) → improvement_recommended', () => {
    expect(determineVerdict(0.60, 0.85, 0.60)).toBe('improvement_recommended');
  });

  it('V⑥  사용자 정의 임계치(0.90, 0.70) 반영', () => {
    expect(determineVerdict(0.88, 0.90, 0.70)).toBe('improvement_recommended');
    expect(determineVerdict(0.91, 0.90, 0.70)).toBe('differentiation_required');
    expect(determineVerdict(0.65, 0.90, 0.70)).toBe('originality_confirmed');
  });
});

// ============================
// B. analyzePortfolioSimilarity 테스트
// ============================

const FAKE_EMBEDDING = Array.from({ length: 1536 }, () => 0.1);
const FAKE_PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const FAKE_COMPARE_ID = '00000000-0000-0000-0000-000000000002';
const FAKE_LOG_ID     = '00000000-0000-0000-0000-000000000099';

function setupMocks(similarityScore: number, hasComparable = true) {
  mockEmbedText.mockResolvedValue(FAKE_EMBEDDING);
  // postgres.js db.execute() 는 RowList (배열) 를 직접 반환
  mockExecute.mockResolvedValue(
    hasComparable
      ? [{ id: FAKE_COMPARE_ID, similarity: similarityScore }]
      : [],
  );
  mockInsertReturning.mockResolvedValue([{ id: FAKE_LOG_ID }]);
  mockUpdateWhere.mockResolvedValue([]);
  mockChat.mockResolvedValue({ content: '피드백 내용입니다.' });
}

describe('Phase 4-2: analyzePortfolioSimilarity 서비스', () => {
  const BASE_OPTIONS = {
    projectId: FAKE_PROJECT_ID,
    proposalText: '온라인 강의 플랫폼으로 수강생 학습 진도를 AI로 분석하여 맞춤형 커리큘럼을 추천합니다.',
    institutionId: 'inst-001',
    feedbackStyle: 'direct' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Sim①  similarity_logs에 INSERT합니다', async () => {
    setupMocks(0.90);
    const result = await analyzePortfolioSimilarity(BASE_OPTIONS);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceProjectId: FAKE_PROJECT_ID,
        verdict: 'differentiation_required',
      }),
    );
    expect(result.logId).toBe(FAKE_LOG_ID);
  });

  it('Sim②  score >= 0.85 → differentiation_required', async () => {
    setupMocks(0.87);
    const result = await analyzePortfolioSimilarity(BASE_OPTIONS);
    expect(result.verdict).toBe('differentiation_required');
    expect(result.topSimilarity).toBeCloseTo(0.87);
  });

  it('Sim③  0.60 <= score < 0.85 → improvement_recommended', async () => {
    setupMocks(0.72);
    const result = await analyzePortfolioSimilarity(BASE_OPTIONS);
    expect(result.verdict).toBe('improvement_recommended');
  });

  it('Sim④  score < 0.60 → originality_confirmed', async () => {
    setupMocks(0.40);
    const result = await analyzePortfolioSimilarity(BASE_OPTIONS);
    expect(result.verdict).toBe('originality_confirmed');
    // LLM 호출하지 않음
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.feedbackText).toContain('독창성 충족');
  });

  it('Sim⑤  feedbackStyle=socratic → 소크라테스식 프롬프트 사용', async () => {
    setupMocks(0.88);
    await analyzePortfolioSimilarity({ ...BASE_OPTIONS, feedbackStyle: 'socratic' });

    expect(mockChat).toHaveBeenCalledOnce();
    const [messages] = mockChat.mock.calls[0];
    const systemContent: string = messages[0].content;
    expect(systemContent).toMatch(/소크라테스식|질문/);
  });

  it('Sim⑥  feedbackStyle=direct → 직접 제안 프롬프트 사용', async () => {
    setupMocks(0.88);
    await analyzePortfolioSimilarity({ ...BASE_OPTIONS, feedbackStyle: 'direct' });

    expect(mockChat).toHaveBeenCalledOnce();
    const [messages] = mockChat.mock.calls[0];
    const systemContent: string = messages[0].content;
    expect(systemContent).toMatch(/차별화 요소|직접|전문가/);
  });

  it('Sim⑦  비교 프로젝트 없을 때 score=0 → originality_confirmed', async () => {
    setupMocks(0, false);
    const result = await analyzePortfolioSimilarity(BASE_OPTIONS);
    expect(result.topSimilarity).toBe(0);
    expect(result.verdict).toBe('originality_confirmed');
    expect(result.comparedProjectId).toBeNull();
  });

  it('Sim⑧  분석 후 portfolio_projects embedding과 similarityScore 업데이트', async () => {
    setupMocks(0.90);
    await analyzePortfolioSimilarity(BASE_OPTIONS);

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        similarityScore: expect.any(Number),
        updatedAt: expect.any(Date),
      }),
    );
  });
});

// ============================
// C. seedGraduatePortfolios 테스트
// ============================

describe('Phase 4-2: seedGraduatePortfolios', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    vi.clearAllMocks();
  });

  it('Seed① OPENAI_API_KEY 없을 때 seeded=0 반환', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await seedGraduatePortfolios();
    expect(result).toEqual({ seeded: 0, skipped: 0 });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('Seed② API 키 있을 때 embedding 미보유 프로젝트 배치 임베딩 후 업데이트', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    mockSelectWhere.mockResolvedValue([
      { id: 'proj-1', proposalText: '기획서 텍스트 1', techStack: 'React' },
      { id: 'proj-2', proposalText: '기획서 텍스트 2', techStack: 'Vue' },
      { id: 'proj-3', proposalText: null, techStack: null },
    ]);
    // embedBatch: 유효한 2건을 한 번에 처리
    mockEmbedBatch.mockResolvedValue([FAKE_EMBEDDING, FAKE_EMBEDDING]);
    mockUpdateWhere.mockResolvedValue([]);

    const result = await seedGraduatePortfolios();
    expect(result.seeded).toBe(2);   // proj-1, proj-2
    expect(result.skipped).toBe(1);  // proj-3 (proposalText 없음)
    // embedBatch가 한 번만 호출되어야 함 (배칭 처리)
    expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
    expect(mockEmbedBatch).toHaveBeenCalledWith([
      '기획서 텍스트 1\nReact',
      '기획서 텍스트 2\nVue',
    ]);
    // update는 배치의 각 항목마다 호출
    expect(mockDb.update).toHaveBeenCalledTimes(2);
  });
});
