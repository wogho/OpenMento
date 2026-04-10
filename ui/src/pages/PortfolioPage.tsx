/**
 * PortfolioPage — 수강생 포트폴리오 워크플로우 메인 페이지 (Phase 4-3)
 *
 * 단계 흐름:
 *   1. 시작 화면  → 페르소나 선택 → POST /portfolio/start
 *   2. 인터뷰 단계  → InterviewChat → POST /portfolio/:goalId/message/stream (SSE)
 *   3. 기획서 작성 → ProposalEditor → Auto-save Draft → POST /portfolio/analyze
 *   4. 독창성 결과 → OriginalityGauge + 피드백 텍스트
 *
 * 개선①: 마운트 시 GET /portfolio/active → 진행 중 세션 자동 복구
 * 개선②: proposalText 변경 시 3초 디바운스 → localStorage + PUT /:goalId/draft
 * 개선③: 인터뷰 응답을 SSE 스트리밍으로 타이핑 UX 구현
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
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

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
  fintech: '', healthcare: '', ecommerce: '',
  education: '', logistics: '', entertainment: '',
  smart_city: '️', hr: '', food: '️', travel: '️',
};

/** draft localStorage 키 (goalId별) */
const draftKey = (goalId: string) => `portfolio-draft-${goalId}`;

/** stage → UI phase 매핑 */
function stageToPhase(stage: PortfolioStage): 'interview' | 'proposal' | 'result' {
  if (stage === 'approved') return 'result';
  if (
    stage === 'planning' ||
    stage === 'hitl_review' ||
    stage === 'security_review' ||
    stage === 'similarity_check'
  )
    return 'proposal';
  return 'interview';
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  // 워크플로우 상태
  const [phase, setPhase] = useState<'start' | 'interview' | 'proposal' | 'result'>('start');
  const [isRestoring, setIsRestoring] = useState(true); // 개선①: 세션 복구 중
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');

  // 인터뷰 채팅
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | undefined>(undefined); // 개선③

  // 기획서
  const [proposalText, setProposalText] = useState('');
  const [feedbackStyle, setFeedbackStyle] = useState<'direct' | 'socratic'>('direct');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle'); // 개선②

  // 분석 결과
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // draft 저장 타이머 ref (디바운스용)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // ── 개선①: 마운트 시 진행 중 세션 복구 ────────────────────────────────────
  useEffect(() => {
    if (!token) { setIsRestoring(false); return; }

    const restore = async () => {
      try {
        const res = await fetch(`${API_BASE}/portfolio/active`, { headers: authHeaders() });
        if (!res.ok) { setIsRestoring(false); return; } // 404 = 새 세션

        const data = await res.json() as {
          goalId: string;
          stage: PortfolioStage;
          messages?: Array<{ role: string; content: string }>;
          personaName?: string;
          personaIndustry?: string;
        };

        const wf: WorkflowState = {
          goalId: data.goalId,
          stage: data.stage,
          personaName: data.personaName,
          personaIndustry: data.personaIndustry,
          awaitingUserInput: true,
        };
        setWorkflow(wf);

        // 메시지 히스토리 복원
        if (data.messages?.length) {
          setMessages(
            data.messages.map((m, i) => ({
              id: `restored-${i}`,
              role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: m.content,
            })),
          );
        }

        // 기획서 draft 복원 (localStorage 우선)
        const savedDraft = localStorage.getItem(draftKey(data.goalId));
        if (savedDraft) setProposalText(savedDraft);

        setPhase(stageToPhase(data.stage));
      } catch {
        // 복구 실패 시 시작화면 유지 (무시)
      } finally {
        setIsRestoring(false);
      }
    };

    void restore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── 개선②: proposalText 변경 시 자동 저장 (3초 디바운스) ────────────────────
  useEffect(() => {
    if (!workflow || !proposalText) return;

    // localStorage 즉시 저장
    localStorage.setItem(draftKey(workflow.goalId), proposalText);

    // 서버 저장은 3초 디바운스
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    setDraftSaveStatus('idle');

    draftTimerRef.current = setTimeout(async () => {
      setDraftSaveStatus('saving');
      try {
        await fetch(`${API_BASE}/portfolio/${workflow.goalId}/draft`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ proposalText }),
        });
        setDraftSaveStatus('saved');
        setTimeout(() => setDraftSaveStatus('idle'), 2000);
      } catch {
        setDraftSaveStatus('idle');
      }
    }, 3000);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [proposalText, workflow, authHeaders]);

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

      if (data.message) {
        setMessages([{ id: `init-${Date.now()}`, role: 'assistant', content: data.message }]);
      }

      toast.success('인터뷰를 시작합니다!');
      setPhase('interview');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── 개선③: SSE 스트리밍 인터뷰 메시지 전송 ────────────────────────────────
  const handleSendMessage = async (content: string) => {
    if (!workflow) return;

    const userMsg: InterviewMessage = { id: `u-${Date.now()}`, role: 'user', content };
    setMessages((prev) => [...prev, userMsg]);
    setIsTyping(true);
    setStreamingContent(undefined);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/portfolio/${workflow.goalId}/message/stream`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content }),
      });

      if (!res.ok || !res.body) {
        throw new Error((await res.json()).error ?? '메시지 전송 실패');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      // SSE 스트림 파싱
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // 마지막 미완성 줄은 다음 청크로 이월

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const rawData = line.slice(6).trim();
          if (!rawData) continue;

          try {
            const parsed = JSON.parse(rawData) as {
              type: 'chunk' | 'done' | 'error';
              text?: string;
              state?: { stage: PortfolioStage; messages?: Array<{ role: string; content: string }> };
              message?: string;
            };

            if (parsed.type === 'chunk' && parsed.text) {
              accumulated += parsed.text;
              setStreamingContent(accumulated);
              setIsTyping(false); // 첫 청크 수신 후 스피너 제거
            } else if (parsed.type === 'done' && parsed.state) {
              // 스트리밍 완료 → 확정 메시지 추가
              setStreamingContent(undefined);
              setMessages((prev) => [
                ...prev,
                { id: `a-${Date.now()}`, role: 'assistant', content: accumulated },
              ]);

              // 단계 전환 감지
              const newStage = parsed.state.stage;
              if (newStage && newStage !== workflow.stage) {
                setWorkflow((prev) => (prev ? { ...prev, stage: newStage } : prev));
                if (newStage === 'planning' || newStage === 'hitl_review') {
                  setTimeout(() => setPhase('proposal'), 800);
                }
              }
            } else if (parsed.type === 'error') {
              throw new Error(parsed.message ?? 'SSE 오류');
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // 불완전 JSON 무시
            throw parseErr;
          }
        }
      }
    } catch (e) {
      setStreamingContent(undefined);
      setError((e as Error).message);
    } finally {
      setIsTyping(false);
      setStreamingContent(undefined);
    }
  };

  // ── 직접 기획서 단계로 이동 ────────────────────────────────────────────────
  const handleSkipToProposal = () => toast.success('인터뷰를 마치고 기획서 작성을 시작합니다.');
      setPhase('proposal');

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
      toast.success('분석이 완료되었습니다!');
      setPhase('result');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── 인터뷰 완료 판단 ────────────────────────────────────────────────────────
  const isInterviewFinished =
    workflow?.stage === 'planning' ||
    workflow?.stage === 'hitl_review' ||
    workflow?.stage === 'security_review' ||
    workflow?.stage === 'similarity_check' ||
    workflow?.stage === 'approved';

  // ── 세션 복구 중 로딩 화면 ─────────────────────────────────────────────────
  if (isRestoring) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex flex-col">
        <header className="shrink-0 h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
          <h1 className="text-lg font-bold text-gray-800" aria-live="polite"> 포트폴리오 기획서</h1>
        </header>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          이전 세션을 복구하는 중…
        </div>
      </div>
    );
  }

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
        <span className="text-lg font-bold text-gray-800"> 포트폴리오 기획서</span>
        {user?.name && (
          <span className="ml-auto text-xs text-gray-500">{user.name}</span>
        )}
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

          {/* 단계 트래커 */}
          {workflow && (
            <section id="portfolio-stage-tracker" className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
              <StageTracker stage={workflow.stage} />
            </section>
          )}

          {/* 에러 배너 */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700" role="alert" aria-live="assertive">
              <span>️</span>
              <span>{error}</span>
            </div>
          )}

          <AnimatePresence mode="wait">
          {/* ── 시작 화면 ── */}
          {phase === 'start' && (
            <motion.section 
              key="start"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5">
              <div className="text-center space-y-2">
                <div className="text-5xl mb-2"></div>
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
                          {INDUSTRY_EMOJI[p.industry] ?? ''}
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
                {isLoading ? '시작 중…' : ' 인터뷰 시작'}
              </button>
            </motion.section>
          )}

          {/* ── 인터뷰 단계 ── */}
          {phase === 'interview' && workflow && (
            <motion.section 
              key="interview"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              id="portfolio-interview-chat" className="space-y-3">
              <div className="h-[520px]">
                <InterviewChat
                  messages={messages}
                  personaName={workflow.personaName}
                  personaIndustry={workflow.personaIndustry}
                  isTyping={isTyping}
                  isFinished={!!isInterviewFinished}
                  onSend={(c) => void handleSendMessage(c)}
                  streamingContent={streamingContent}
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
                   기획서 작성 단계로 이동
                </button>
              )}
            </motion.section>
          )}

          {/* ── 기획서 작성 단계 ── */}
          {phase === 'proposal' && (
            <motion.section 
              key="proposal"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-800"> 기획서 작성</h2>
                <div className="flex items-center gap-3">
                  {/* 개선②: 자동 저장 상태 표시 */}
                  {draftSaveStatus === 'saving' && (
                    <span className="text-xs text-gray-400">저장 중…</span>
                  )}
                  {draftSaveStatus === 'saved' && (
                    <span className="text-xs text-green-600 font-medium"> 자동 저장됨</span>
                  )}
                  {/* 피드백 스타일 선택 */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500 font-medium">AI 피드백:</span>
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
              </div>

              <ProposalEditor
                value={proposalText}
                onChange={setProposalText}
                onAnalyze={() => void handleAnalyze()}
                isAnalyzing={isAnalyzing}
              />
            </motion.section>
          )}

          {/* ── 독창성 분석 결과 ── */}
          {phase === 'result' && analysisResult && (
            <motion.section 
              key="result"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.5 }}
              className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                <h2 className="text-base font-bold text-gray-800"> 독창성 분석 결과</h2>
                <div id="portfolio-originality-gauge">
                <OriginalityGauge
                  similarityScore={analysisResult.topSimilarity}
                  verdict={analysisResult.verdict}
                />
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                <h3 className="text-sm font-bold text-gray-700"> AI 차별화 피드백</h3>
                <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans bg-gray-50 rounded-xl p-4 border border-gray-100">
                  {analysisResult.feedbackText}
                </pre>
              </div>

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
                     최종 승인 요청
                  </button>
                )}
              </div>
            </motion.section>
          )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
