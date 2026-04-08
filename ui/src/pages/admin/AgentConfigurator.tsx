/**
 * Phase 3-4 — 에이전트 등록·설정 폼
 *
 * JSON 입력 필드 없음. 전부 드롭다운·토글·숫자 입력으로 구성.
 *
 * 목록: GET  /admin/agents
 * 생성: POST /admin/agents
 * 수정: PUT  /admin/agents/:id
 * 삭제: DELETE /admin/agents/:id
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/* ─────────────────────────────── 상수 ─────────────────────────────── */

const ROLES = [
  { value: 'orchestrator',      label: '오케스트레이터',     desc: '전체 에이전트 조율' },
  { value: 'ai_instructor',     label: 'AI 강사',            desc: '커리큘럼 기반 코드 리뷰' },
  { value: 'ai_tutor',          label: 'AI 튜터',            desc: '소크라테스식 질문 응답' },
  { value: 'ews_monitor',       label: 'EWS 모니터',         desc: '수강생 위험 감지' },
  { value: 'mental_care',       label: '멘탈케어',           desc: '공감적 어조 상담' },
  { value: 'portfolio_reviewer',label: '포트폴리오 심사',    desc: '유사도 분석 및 피드백' },
] as const;

type AgentRole = (typeof ROLES)[number]['value'];

const MODELS: { value: string; label: string; provider: string; recommended?: AgentRole[] }[] = [
  { value: 'gpt-4o',             label: 'GPT-4o',              provider: 'openai',    recommended: ['orchestrator', 'portfolio_reviewer'] },
  { value: 'gpt-4o-mini',        label: 'GPT-4o mini',         provider: 'openai',    recommended: ['ews_monitor'] },
  { value: 'claude-haiku-3-5',   label: 'Claude Haiku 3.5',   provider: 'anthropic', recommended: ['ai_instructor', 'ai_tutor', 'mental_care'] },
  { value: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5',  provider: 'anthropic',  },
  { value: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash',   provider: 'google',    },
];

/* ─────────────────────────────── 타입 ─────────────────────────────── */

interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  reportsTo: string | null;
  adapterConfig: { provider: string; model: string };
  fallbackAdapterConfig?: { provider: string; model: string } | null;
  monthlyBudgetUsd: number;
  isActive: boolean;
  skillId?: string | null;
}

interface SkillOption {
  id: string;
  name: string;
}

interface FormValues {
  name: string;
  role: AgentRole;
  reportsTo: string;
  model: string;
  fallbackModel: string;
  monthlyBudgetUsd: number;
  skillId: string;
}

/* ─────────────────────────── 헬퍼 ─────────────────────────── */

function modelProvider(modelValue: string): string {
  return MODELS.find((m) => m.value === modelValue)?.provider ?? 'openai';
}

function RecommendedBadge() {
  return (
    <span className="ml-1 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
      추천
    </span>
  );
}

/* ─────────────────────── 에이전트 조직도 트리 노드 ─────────────────────── */

function AgentTreeNode({
  agent,
  allAgents,
  depth,
  selectedId,
  isCreating,
  onSelect,
  onDelete,
}: {
  agent: Agent;
  allAgents: Agent[];
  depth: number;
  selectedId: string | null;
  isCreating: boolean;
  onSelect: (a: Agent) => void;
  onDelete: (a: Agent) => void;
}) {
  const children = allAgents.filter((a) => a.reportsTo === agent.id);
  const roleLabel = ROLES.find((r) => r.value === agent.role)?.label ?? agent.role;
  const isSelected = selectedId === agent.id && !isCreating;

  return (
    <>
      <li
        onClick={() => onSelect(agent)}
        className={`py-2.5 pr-3 cursor-pointer transition-colors group border-b border-gray-50 ${
          isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <div className="flex items-start gap-1.5">
          {depth > 0 && (
            <span className="text-gray-300 text-xs mt-0.5 shrink-0 select-none">└</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-800 truncate">{agent.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{roleLabel}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.isActive ? 'bg-green-400' : 'bg-gray-300'}`} />
              <span className="text-[10px] text-gray-400 truncate">{agent.adapterConfig.model}</span>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(agent); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs p-1 rounded transition shrink-0"
            title="삭제"
          >
            🗑️
          </button>
        </div>
      </li>
      {children.map((child) => (
        <AgentTreeNode
          key={child.id}
          agent={child}
          allAgents={allAgents}
          depth={depth + 1}
          selectedId={selectedId}
          isCreating={isCreating}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   메인 컴포넌트
══════════════════════════════════════════════════════════════════════ */

export default function AgentConfigurator() {
  const { token } = useAuth();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { register, handleSubmit, reset, watch, formState: { errors, isDirty } } = useForm<FormValues>({
    defaultValues: {
      name: '', role: 'ai_tutor', reportsTo: '',
      model: 'claude-haiku-3-5', fallbackModel: 'gpt-4o-mini',
      monthlyBudgetUsd: 10, skillId: '',
    },
  });

  const watchedRole = watch('role') as AgentRole;
  const watchedModel = watch('model');

  /* ── 이탈 방지: isDirty 새로고침/스균 닫기 대비 ── */
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  /* ── 에이전트 목록 조회 ── */
  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ['admin-agents'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('에이전트 조회 실패');
      return res.json() as Promise<Agent[]>;
    },
    staleTime: 30_000,
  });

  /* ── 스킬 목록 조회 ── */
  const { data: skills = [] } = useQuery<SkillOption[]>({
    queryKey: ['admin-skills'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('스킬 조회 실패');
      return res.json() as Promise<SkillOption[]>;
    },
    staleTime: 60_000,
  });

  /* ── 에이전트 선택 → 폼 채우기 ── */
  const handleSelect = (agent: Agent) => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 정말 이동하시겠습니까?')) return;
    setSelectedId(agent.id);
    setIsCreating(false);
    setErrorMsg('');
    setSuccessMsg('');
    reset({
      name: agent.name,
      role: agent.role,
      reportsTo: agent.reportsTo ?? '',
      model: agent.adapterConfig.model,
      fallbackModel: agent.fallbackAdapterConfig?.model ?? 'gpt-4o-mini',
      monthlyBudgetUsd: agent.monthlyBudgetUsd ?? 10,
      skillId: agent.skillId ?? '',
    });
  };

  /* ── 신규 생성 모드 ── */
  const handleNew = () => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 새 에이전트를 등록하시겠습니까?')) return;
    setSelectedId(null);
    setIsCreating(true);
    setErrorMsg('');
    setSuccessMsg('');
    reset({
      name: '', role: 'ai_tutor', reportsTo: '',
      model: 'claude-haiku-3-5', fallbackModel: 'gpt-4o-mini',
      monthlyBudgetUsd: 10, skillId: '',
    });
  };

  /* ── 저장 (POST / PUT) ── */
  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const body = {
        name: values.name,
        role: values.role,
        reportsTo: values.reportsTo || null,
        adapterConfig: {
          provider: modelProvider(values.model),
          model: values.model,
        },
        fallbackAdapterConfig: values.fallbackModel
          ? { provider: modelProvider(values.fallbackModel), model: values.fallbackModel }
          : null,
        monthlyBudgetUsd: Number(values.monthlyBudgetUsd),
        skillId: values.skillId || null,
      };

      const url = isCreating
        ? `${API_BASE}/admin/agents`
        : `${API_BASE}/admin/agents/${selectedId}`;
      const method = isCreating ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? '저장 실패');
      }
      return res.json() as Promise<Agent>;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin-agents'] });
      qc.invalidateQueries({ queryKey: ['admin-agents-list'] });
      setSelectedId(result.id);
      setIsCreating(false);
      setErrorMsg('');
      setSuccessMsg('에이전트 설정이 저장되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (e: Error) => {
      setErrorMsg(e.message);
    },
  });

  /* ── 삭제 ── */
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/admin/agents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('삭제 실패');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-agents'] });
      qc.invalidateQueries({ queryKey: ['admin-agents-list'] });
      setSelectedId(null);
      setIsCreating(false);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const onSubmit = handleSubmit((values) => saveMutation.mutate(values));

  /* ════════════════════════════════ JSX ═══════════════════════════════ */

  return (
    <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">

      {/* ══ 좌측 — 에이전트 목록 패널 ══ */}
      <aside className="w-64 shrink-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">에이전트</span>
          <button
            onClick={handleNew}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            + 등록
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {isLoading && <li className="p-4 text-sm text-gray-400 text-center">불러오는 중…</li>}

          {/* 신규 생성 중 가상 항목 */}
          {isCreating && (
            <li className="px-4 py-3 bg-blue-50 border-l-2 border-blue-500 border-b border-gray-50">
              <p className="text-sm font-medium text-blue-700">신규 에이전트</p>
              <p className="text-xs text-blue-400 mt-0.5">설정 후 저장</p>
            </li>
          )}

          {/* 조직도 트리: reportsTo 없는 루트 에이전트부터 재귀 렌더링 */}
          {agents
            .filter((a) => !a.reportsTo || !agents.some((p) => p.id === a.reportsTo))
            .map((root) => (
              <AgentTreeNode
                key={root.id}
                agent={root}
                allAgents={agents}
                depth={0}
                selectedId={selectedId}
                isCreating={isCreating}
                onSelect={handleSelect}
                onDelete={(agent) => {
                  if (confirm(`"${agent.name}" 에이전트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                    deleteMutation.mutate(agent.id);
                  }
                }}
              />
            ))}
        </ul>
      </aside>

      {/* ══ 우측 — 설정 폼 ══ */}
      <section className="flex-1 flex flex-col bg-white border border-gray-200 rounded-xl overflow-y-auto">
        {selectedId || isCreating ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-6 p-6">
            {/* ── 헤더 ── */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-800">
                {isCreating ? '새 에이전트 등록' : '에이전트 설정'}
              </h2>
              <div className="flex items-center gap-2">
                {successMsg && (
                  <span className="text-xs text-green-600 font-medium animate-fade-in">✓ {successMsg}</span>
                )}
                {errorMsg && (
                  <span className="text-xs text-red-500">{errorMsg}</span>
                )}
                <button
                  type="submit"
                  disabled={(!isDirty && !isCreating) || saveMutation.isPending}
                  className={`text-sm px-4 py-1.5 rounded-lg font-medium transition
                    ${isDirty || isCreating
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                >
                  {saveMutation.isPending ? '저장 중…' : (isCreating ? '등록' : '저장')}
                </button>
              </div>
            </div>

            {/* ── 섹션: 기본 정보 ── */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-100 w-full">
                기본 정보
              </legend>

              {/* 이름 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">에이전트 이름</label>
                <input
                  {...register('name', { required: '이름을 입력하세요' })}
                  type="text"
                  placeholder="예: AI 강사 (Java반)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>

              {/* 역할 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">역할</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map((role) => (
                    <label
                      key={role.value}
                      className={`flex items-start gap-2 p-2.5 border rounded-lg cursor-pointer transition
                        ${watchedRole === role.value
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <input
                        {...register('role')}
                        type="radio"
                        value={role.value}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <p className="text-xs font-medium text-gray-800">{role.label}</p>
                        <p className="text-[10px] text-gray-400">{role.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 상위 에이전트 (reportsTo) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">상위 에이전트 (보고 대상)</label>
                <select
                  {...register('reportsTo')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— 최상위 (없음) —</option>
                  {agents
                    .filter((a) => a.id !== selectedId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({ROLES.find((r) => r.value === a.role)?.label ?? a.role})
                      </option>
                    ))}
                </select>
              </div>
            </fieldset>

            {/* ── 섹션: LLM 모델 설정 ── */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-100 w-full">
                LLM 모델 설정
              </legend>

              {/* 기본 모델 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">기본 모델</label>
                <select
                  {...register('model', { required: true })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                      {m.recommended?.includes(watchedRole) ? ' ★ 추천' : ''}
                    </option>
                  ))}
                </select>
                {MODELS.find((m) => m.value === watchedModel)?.recommended?.includes(watchedRole) && (
                  <p className="text-xs text-green-600 mt-1">✓ 이 역할에 권장되는 모델입니다.</p>
                )}
              </div>

              {/* 백업 모델 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  백업 모델
                  <span className="ml-1 text-[10px] text-gray-400">(장애 시 자동 전환)</span>
                </label>
                <select
                  {...register('fallbackModel')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— 백업 없음 —</option>
                  {MODELS.filter((m) => m.value !== watchedModel).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">
                  서킷 브레이커: 주 모델 5회 연속 실패 시 5분간 백업 모델로 자동 전환됩니다.
                </p>
              </div>
            </fieldset>

            {/* ── 섹션: 예산 & 스킬 ── */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-100 w-full">
                예산 및 스킬 파일
              </legend>

              {/* 월 예산 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  월 예산 한도 <span className="text-gray-400">(USD)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">$</span>
                  <input
                    {...register('monthlyBudgetUsd', {
                      required: true,
                      min: { value: 0, message: '0 이상이어야 합니다' },
                      max: { value: 10000, message: '10,000 이하로 설정하세요' },
                      valueAsNumber: true,
                    })}
                    type="number"
                    step="0.5"
                    min="0"
                    max="10000"
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="text-xs text-gray-400">/ 월</span>
                </div>
                {errors.monthlyBudgetUsd && (
                  <p className="text-xs text-red-500 mt-1">{errors.monthlyBudgetUsd.message}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">
                  80% 도달 시 경고 알림 발송, 100% 도달 시 에이전트 일시정지됩니다.
                </p>
              </div>

              {/* 스킬 파일 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  적용 스킬 파일
                  <span className="ml-1 text-[10px] text-gray-400">(저장 즉시 AI 강사 프롬프트에 반영)</span>
                </label>
                <select
                  {...register('skillId')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— 스킬 파일 없음 —</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </fieldset>

            {/* 구분선 + 경고 영역 */}
            {!isCreating && selectedId && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400 mb-2">위험 영역</p>
                <button
                  type="button"
                  onClick={() => {
                    const agent = agents.find((a) => a.id === selectedId);
                    if (agent && confirm(`"${agent.name}" 에이전트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                      deleteMutation.mutate(selectedId);
                    }
                  }}
                  className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
                >
                  🗑️ 에이전트 삭제
                </button>
              </div>
            )}
          </form>
        ) : (
          /* 선택 전 빈 상태 */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-8">
            <span className="text-5xl">🤖</span>
            <p className="font-medium text-gray-500">좌측에서 에이전트를 선택하세요</p>
            <p className="text-xs text-center max-w-xs">
              에이전트 이름, 역할, 모델, 예산, 스킬 파일을<br />
              JSON 없이 폼으로 구성할 수 있습니다.
            </p>
            <button
              onClick={handleNew}
              className="mt-2 text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              + 첫 번째 에이전트 등록
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
