/**
 * PortfolioPage — 수강생 포트폴리오 워크플로우 메인 페이지 (Phase 4-3)
 *
 * 단계 흐름:
 *   1. 시작 화면  → 페르소나 선택 → POST /portfolio/start
 *   2. 인터뷰 단계  → InterviewChat → POST /portfolio/:goalId/message
 *   3. 기획서 작성 → ProposalEditor → POST /portfolio/analyze
 *   4. 독창성 결과 → OriginalityGauge + 피드백 텍스트
 *
 * StageTracker는 모든 단계에서 상단에 고정 표시.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import StageTracker, { type PortfolioStage } from '../components/portfolio/StageTracker';
import InterviewChat, { type InterviewMessage } from '../components/portfolio/InterviewChat';
import ProposalEditor from '../components/portfolio/ProposalEditor';
import OriginalityGauge, { type SimilarityVerdict } from '../components/portfolio/OriginalityGauge';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface PersonaOption {
  id: string;
  name: string;
  industry: string;
  description?: string;
}

interface WorkflowState {
  goalId: string;
  stage: PortfolioStage;
  personaId?: string;
  personaName?: string;
  personaIndustry?: string;
  awaitingUserInput: boolean;
}

interface AnalysisResult {
  topSimilarity: number;
  verdict: SimilarityVerdict;
  feedbackText: string;
  logId: string;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const INDUSTRY_EMOJI: Record<string, string> = {
  fintech: '🏦', healthcare: '🏥', ecommerce: '🛒',
  education: '🎓', logistics: '🚚', entertainment: '🎬',
  smart_city: '🏙️', hr: '💼', food: '🍽️', travel: '✈️',
};

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  // 워크플로우 상태
  const [phase, setPhase] = useState<'start' | 'interview' | 'proposal' | 'result'>('start');
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');

  // 인터뷰 채팅
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  // 기획서
  const [proposalText, setProposalText] = useState('');
  const [feedbackStyle, setFeedbackStyle] = useState<'direct' | 'socratic'>('direct');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 분석 결과
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // ── 페르소나 목록 로드 ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/portfolio/personas`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: PersonaOption[]) => setPersonas(data))
      .catch(() => setError('페르소나 목록을 불러오지 못했습니다.'));
  }, [token, authHeaders]);

  // ── 워크플로우 시작 ─────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!selectedPersonaId) return;
    setIsLoading(true);
    setError(null);

    try {
      const courseId = import.meta.env.VITE_DEFAULT_COURSE_ID ?? '00000000-0000-0000-0000-000000000001';
      const res = await fetch(`${API_BASE}/portfolio/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ courseId, personaId: selectedPersonaId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '시작 실패');

      const data = await res.json();
      const persona = personas.find((p) => p.id === selectedPersonaId);

      const wf: WorkflowState = {
        goalId: data.goalId,
        stage: data.stage ?? 'interview',
        personaId: selectedPersonaId,
        personaName: persona?.name ?? data.personaName,
        personaIndustry: persona?.industry,
        awaitingUserInput: true,
      };
      setWorkflow(wf);

      // 첫 AI 메시지 (서버 응답에 포함될 수 있음)
      if (data.message) {
        setMessages([{ id: `init-${Date.now()}`, role: 'assistant', content: data.message }]);
      }

      setPhase('interview');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── 인터뷰 메시지 전송 ──────────────────────────────────────────────────────
  const handleSendMessage = async (content: string) => {
    if (!workflow) return;

    const userMsg: InterviewMessage = { id: `u-${Date.now()}`, role: 'user', content };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/portfolio/${workflow.goalId}/message`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '메시지 전송 실패');

      const data = await res.json();

      if (data.message) {
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: 'assistant', content: data.message },
        ]);
      }

      // 단계 전환 감지 (planning으로 이동하면 기획서 단계)
      if (data.stage && data.stage !== workflow.stage) {
        setWorkflow((prev) => prev ? { ...prev, stage: data.stage } : prev);

        if (data.stage === 'planning' || data.stage === 'hitl_review') {
          setTimeout(() => setPhase('proposal'), 800);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsTyping(false);
    }
  };

  // ── 직접 기획서 단계로 이동 (인터뷰 완료 버튼) ────────────────────────────
  const handleSkipToProposal = () => setPhase('proposal');

  // ── 유사도 분석 요청 ────────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!workflow || proposalText.trim().length < 50) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/portfolio/analyze`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          projectId: workflow.goalId,
          proposalText: proposalText.trim(),
          feedbackStyle,
          compareScope: 'all',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '분석 실패');

      const data: AnalysisResult = await res.json();
      setAnalysisResult(data);
      setPhase('result');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── 현재 페르소나 (인터뷰 완료 판단) ────────────────────────────────────────
  const isInterviewFinished =
    workflow?.stage === 'planning' ||
    workflow?.stage === 'hitl_review' ||
    workflow?.stage === 'security_review' ||
    workflow?.stage === 'similarity_check' ||
    workflow?.stage === 'approved';

  // ── 렌더링 ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
      {/* 상단 헤더 */}
      <header className="shrink-0 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
        <button
          onClick={() => navigate('/chat')}
          className="text-gray-500 hover:text-gray-800 transition"
          title="AI 튜터로 이동"
        >
          ←
        </button>
        <span className="text-lg font-bold text-gray-800">📋 포트폴리오 기획서</span>
        {user?.name && (
          <span className="ml-auto text-xs text-gray-500">{user.name}</span>
        )}
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

          {/* 단계 트래커 */}
          {workflow && (
            <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <StageTracker stage={workflow.stage} />
            </section>
          )}

          {/* 에러 배너 */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* ── 시작 화면 ── */}
          {phase === 'start' && (
            <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5">
              <div className="text-center space-y-2">
                <div className="text-5xl mb-2">🤖</div>
                <h2 className="text-xl font-bold text-gray-800">포트폴리오 기획서 워크플로우</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  AI 고객 페르소나와 인터뷰를 진행하며 아이디어를 구체화하고,<br />
                  역대 수료생 프로젝트와의 독창성을 검증합니다.
                </p>
              </div>

              {/* 페르소나 선택 */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">
                  고객 페르소나를 선택하세요
                </label>
                {personas.length === 0 ? (
                  <p className="text-sm text-gray-400">페르소나를 불러오는 중…</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {personas.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPersonaId(p.id)}
                        className={`
                          text-left p-3 rounded-xl border transition-all
                          ${selectedPersonaId === p.id
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : 'border-gray-200 bg-white hover:border-gray-300'}
                        `}
                      >
                        <span className="text-2xl mr-2">
                          {INDUSTRY_EMOJI[p.industry] ?? '🤖'}
                        </span>
                        <span className="font-semibold text-sm text-gray-800">{p.name}</span>
                        {p.description && (
                          <p className="mt-1 text-xs text-gray-400 line-clamp-2">{p.description}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => void handleStart()}
                disabled={!selectedPersonaId || isLoading}
                className="
                  w-full py-3 rounded-xl text-sm font-semibold
                  bg-indigo-600 text-white hover:bg-indigo-700
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors duration-150
                "
              >
                {isLoading ? '시작 중…' : '🚀 인터뷰 시작'}
              </button>
            </section>
          )}

          {/* ── 인터뷰 단계 ── */}
          {phase === 'interview' && workflow && (
            <section className="space-y-3">
              <div className="h-[520px]">
                <InterviewChat
                  messages={messages}
                  personaName={workflow.personaName}
                  personaIndustry={workflow.personaIndustry}
                  isTyping={isTyping}
                  isFinished={!!isInterviewFinished}
                  onSend={(c) => void handleSendMessage(c)}
                />
              </div>
              {!isInterviewFinished && (
                <button
                  onClick={handleSkipToProposal}
                  className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline transition"
                >
                  인터뷰를 건너뛰고 기획서 바로 작성하기 →
                </button>
              )}
              {isInterviewFinished && (
                <button
                  onClick={() => setPhase('proposal')}
                  className="
                    w-full py-3 rounded-xl text-sm font-semibold
                    bg-blue-600 text-white hover:bg-blue-700
                    transition-colors duration-150
                  "
                >
                  📝 기획서 작성 단계로 이동
                </button>
              )}
            </section>
          )}

          {/* ── 기획서 작성 단계 ── */}
          {phase === 'proposal' && (
            <section className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-800">📝 기획서 작성</h2>
                {/* 피드백 스타일 선택 */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 font-medium">AI 피드백 스타일:</span>
                  {(['direct', 'socratic'] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => setFeedbackStyle(style)}
                      className={`
                        px-2.5 py-1 rounded-lg border font-semibold transition-colors
                        ${feedbackStyle === style
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}
                      `}
                    >
                      {style === 'direct' ? '직접 제안' : '소크라테스식'}
                    </button>
                  ))}
                </div>
              </div>

              <ProposalEditor
                value={proposalText}
                onChange={setProposalText}
                onAnalyze={() => void handleAnalyze()}
                isAnalyzing={isAnalyzing}
              />
            </section>
          )}

          {/* ── 독창성 분석 결과 ── */}
          {phase === 'result' && analysisResult && (
            <section className="space-y-4">
              {/* 독창성 게이지 */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                <h2 className="text-base font-bold text-gray-800">📊 독창성 분석 결과</h2>
                <OriginalityGauge
                  similarityScore={analysisResult.topSimilarity}
                  verdict={analysisResult.verdict}
                />
              </div>

              {/* AI 피드백 텍스트 */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-gray-700">💬 AI 차별화 피드백</h3>
                <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans bg-gray-50 rounded-xl p-4 border border-gray-100">
                  {analysisResult.feedbackText}
                </pre>
              </div>

              {/* 다음 행동 버튼 */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setPhase('proposal')}
                  className="
                    flex-1 py-3 rounded-xl text-sm font-semibold
                    bg-white border border-gray-300 text-gray-700
                    hover:bg-gray-50 transition-colors duration-150
                  "
                >
                  ← 기획서 수정하기
                </button>
                {analysisResult.verdict === 'originality_confirmed' && (
                  <button
                    className="
                      flex-1 py-3 rounded-xl text-sm font-semibold
                      bg-green-600 text-white hover:bg-green-700
                      transition-colors duration-150
                    "
                    onClick={() => alert('강사에게 최종 승인을 요청합니다.')}
                  >
                    ✅ 최종 승인 요청
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
