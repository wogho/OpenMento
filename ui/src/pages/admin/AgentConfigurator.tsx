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

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

/* ─────────────────────────────── 상수 ─────────────────────────────── */

const ROLES = [
  { value: 'orchestrator',      label: '오케스트레이터',     desc: '전체 에이전트 조율' },
  { value: 'ai_instructor',     label: 'AI 강사',            desc: '커리큘럼 기반 코드 리뷰' },
  { value: 'ai_tutor',          label: 'AI 튜터',            desc: '소크라테스식 질문 응답' },
  { value: 'ews_monitor',       label: 'EWS 모니터',         desc: '수강생 위험 감지' },
  { value: 'mental_care',       label: '멘탈케어',           desc: '공감적 어조 상담' },
  { value: 'portfolio_reviewer',label: '포트폴리오 심사',    desc: '유사도 분석 및 피드백' },
] as const;

// 역할별 기본 스킬 설명 (skill-registry의 description frontmatter 요약)
const DEFAULT_SKILL_DESC: Record<string, string> = {
  orchestrator:
    '모든 학생·관리자 메시지의 1차 진입점. 의도를 분류하고 코드 리뷰 → ai_instructor, 개념 질문 → ai_tutor, 감정 위기 → mental_care, 위험 분석 → ews_monitor, 포트폴리오 → portfolio_reviewer 로 라우팅합니다.',
  ai_instructor:
    '커리큘럼 기반 코드 리뷰·과제 채점. "코드 리뷰해줘" / "과제 채점" / "피드백 주세요" 요청, 제출 이벤트에 작동합니다. 전체 코드 재작성은 하지 않습니다.',
  ai_tutor:
    '소크라테스식 질문으로 개념·디버깅 안내. "왜 에러가 나요?", "이해가 안 돼요" 등의 혼란 신호에 반응합니다. 정답 코드를 직접 제공하지 않습니다.',
  ews_monitor:
    '출결·과제 완료율·상담 이력·튜터 상호작용 빈도를 종합해 탈락 위험 점수(0–100)를 산출합니다. 학생과 직접 대화하지 않으며 관리자·시스템용 리포트를 출력합니다.',
  mental_care:
    '소진·불안·임포스터 증후군 신호("힘들어요", "포기하고 싶어요")에 공감과 미시 회복 단계를 제안합니다. 의료적 진단은 하지 않으며 자해 의도 감지 시 즉시 CRISIS_ALERT를 발동합니다.',
  portfolio_reviewer:
    '최종 포트폴리오 독창성·시장 준비도 평가. 유사도 >60% → 고위험, >30% → 수동 검토 플래그. 강사용 요약과 학생용 건설적 피드백을 분리 출력합니다.',
};

type AgentRole = (typeof ROLES)[number]['value'];

const MODELS: { value: string; label: string; provider: string; recommended?: AgentRole[] }[] = [
  { value: 'gpt-4o',             label: 'GPT-4o',              provider: 'openai',    recommended: ['orchestrator', 'portfolio_reviewer'] },
  { value: 'gpt-4o-mini',        label: 'GPT-4o mini',         provider: 'openai',    recommended: ['ews_monitor'] },
  { value: 'claude-haiku-3-5',   label: 'Claude Haiku 3.5',   provider: 'anthropic', recommended: ['ai_instructor', 'ai_tutor', 'mental_care'] },
  { value: 'claude-sonnet-4-5',  label: 'Claude Sonnet 4.5',  provider: 'anthropic',  },
  { value: 'gemini-2.0-flash',   label: 'Gemini 2.0 Flash',   provider: 'google',    },
  { value: 'gemini-cli-default', label: 'Gemini CLI (로컬)',    provider: 'gemini_cli',},
  { value: 'openclaw-model',     label: 'OpenClaw Gateway',   provider: 'openclaw',  },
];

/* ─────────────────────────────── 타입 ─────────────────────────────── */

interface Agent {
  id: string;
  name: string;
  slug: string;
  role: AgentRole;
  title?: string | null;
  icon?: string | null;
  capabilities?: string | null;
  status: 'idle' | 'running' | 'paused' | 'error' | 'terminated';
  reportsTo: string | null;
  adapterConfig: { provider: string; model: string };
  fallbackAdapterConfig?: { provider: string; model: string } | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  runtimeConfig: { heartbeat?: { enabled: boolean; intervalSec: number; maxConcurrentRuns: number; proactive?: boolean; dailyLimit?: number; promptTemplate?: string } };
  permissions: { canHireDirect?: boolean; canAssignTasks?: boolean; canAccessSecrets?: boolean };
  isActive: boolean;
  skillId?: string | null;
  ragEnabled: boolean;
}

interface SkillOption {
  id: string;
  name: string;
}

interface FormValues {
  name: string;
  role: AgentRole;
  title: string;
  icon: string;
  capabilities: string;
  reportsTo: string;
  model: string;
  fallbackModel: string;
  budgetMonthlyCents: number;
  skillId: string;
  ragEnabled: boolean;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number;
  heartbeatMaxConcurrentRuns: number;
  heartbeatProactive: boolean;
  heartbeatDailyLimit: number;
  heartbeatPromptTemplate: string;
  canHireDirect: boolean;
  canAssignTasks: boolean;
  canAccessSecrets: boolean;
}

/* ─────────────────────────── 헬퍼 ─────────────────────────── */

function modelProvider(modelValue: string): string {
  return MODELS.find((m) => m.value === modelValue)?.provider ?? 'openai';
}

/* ─────────────────────────── 상태 배지 ─────────────────────────── */

const STATUS_META: Record<string, { label: string; color: string }> = {
  idle:       { label: '대기 중',   color: 'bg-gray-100 text-gray-500' },
  running:    { label: '실행 중',   color: 'bg-green-100 text-green-700' },
  paused:     { label: '일시정지', color: 'bg-amber-100 text-amber-700' },
  error:      { label: '오류',      color: 'bg-red-100 text-red-600' },
  terminated: { label: '종료됨',   color: 'bg-gray-200 text-gray-400' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
      {meta.label}
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
              <div className="flex items-center gap-1.5">
                {agent.icon && <span className="text-sm">{agent.icon}</span>}
                <p className="text-sm font-medium text-gray-800 truncate">{agent.title || agent.name}</p>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{roleLabel}</p>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                <StatusBadge status={agent.status ?? 'idle'} />
                <span className="text-[10px] text-gray-400 truncate">{agent.adapterConfig.model}</span>
              </div>
            </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(agent); }}
            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs p-1 rounded transition shrink-0"
            title="삭제"
          >
            ️
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
      name: '', role: 'ai_tutor', title: '', icon: '', capabilities: '',
      reportsTo: '', model: 'claude-haiku-3-5', fallbackModel: 'gpt-4o-mini',
      budgetMonthlyCents: 1000, skillId: '',
      ragEnabled: false,
      heartbeatEnabled: false, heartbeatIntervalSec: 300, heartbeatMaxConcurrentRuns: 1,
      heartbeatProactive: false, heartbeatDailyLimit: 10, heartbeatPromptTemplate: '',
      canHireDirect: false, canAssignTasks: false, canAccessSecrets: false,
    },
  });

  const watchedRole = watch('role') as AgentRole;
  const watchedModel = watch('model');
  const watchedSkillId = watch('skillId');
  const watchedRagEnabled = watch('ragEnabled');
  const watchedHeartbeatEnabled = watch('heartbeatEnabled');
  const watchedBudgetCents = watch('budgetMonthlyCents');

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
      const data = await res.json();
      return Array.isArray(data) ? data : (data.agents ?? []);
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
      const data = await res.json();
      return Array.isArray(data) ? data : (data.skills ?? []);
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
      title: agent.title ?? '',
      icon: agent.icon ?? '',
      capabilities: agent.capabilities ?? '',
      reportsTo: agent.reportsTo ?? '',
      model: agent.adapterConfig.model,
      fallbackModel: agent.fallbackAdapterConfig?.model ?? '',
      budgetMonthlyCents: agent.budgetMonthlyCents ?? 1000,
      skillId: agent.skillId ?? '',
      ragEnabled: agent.ragEnabled ?? true,
      heartbeatEnabled: agent.runtimeConfig?.heartbeat?.enabled ?? false,
      heartbeatIntervalSec: agent.runtimeConfig?.heartbeat?.intervalSec ?? 300,
      heartbeatMaxConcurrentRuns: agent.runtimeConfig?.heartbeat?.maxConcurrentRuns ?? 1,
      heartbeatProactive: agent.runtimeConfig?.heartbeat?.proactive ?? false,
      heartbeatDailyLimit: agent.runtimeConfig?.heartbeat?.dailyLimit ?? 10,
      heartbeatPromptTemplate: agent.runtimeConfig?.heartbeat?.promptTemplate ?? '',
      canHireDirect: agent.permissions?.canHireDirect ?? false,
      canAssignTasks: agent.permissions?.canAssignTasks ?? false,
      canAccessSecrets: agent.permissions?.canAccessSecrets ?? false,
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
      name: '', role: 'ai_tutor', title: '', icon: '', capabilities: '',
      reportsTo: '', model: 'claude-haiku-3-5', fallbackModel: 'gpt-4o-mini',
      budgetMonthlyCents: 1000, skillId: '',
      ragEnabled: false,
      heartbeatEnabled: false, heartbeatIntervalSec: 300, heartbeatMaxConcurrentRuns: 1,
      heartbeatProactive: false, heartbeatDailyLimit: 10, heartbeatPromptTemplate: '',
      canHireDirect: false, canAssignTasks: false, canAccessSecrets: false,
    });
  };

  /* ── 저장 (POST / PUT) ── */
  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // slug: 이름에서 자동 생성 (영소문자·숫자·하이픈)
      const slug = values.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'agent';
      const body = {
        name: values.name,
        slug,
        role: values.role,
        title: values.title || null,
        icon: values.icon || null,
        capabilities: values.capabilities || null,
        reportsTo: values.reportsTo || null,
        adapterConfig: {
          provider: modelProvider(values.model),
          model: values.model,
        },
        fallbackAdapterConfig: values.fallbackModel
          ? { provider: modelProvider(values.fallbackModel), model: values.fallbackModel }
          : null,
        budgetMonthlyCents: Number(values.budgetMonthlyCents),
        skillId: values.skillId || null,
        ragEnabled: values.ragEnabled,
        runtimeConfig: values.heartbeatEnabled
          ? { heartbeat: { enabled: true, intervalSec: Number(values.heartbeatIntervalSec), maxConcurrentRuns: Number(values.heartbeatMaxConcurrentRuns), proactive: values.heartbeatProactive, dailyLimit: Number(values.heartbeatDailyLimit), promptTemplate: values.heartbeatPromptTemplate || undefined } }
          : { heartbeat: { enabled: false, intervalSec: 300, maxConcurrentRuns: 1, proactive: false } },
        permissions: {
          canHireDirect: values.canHireDirect,
          canAssignTasks: values.canAssignTasks,
          canAccessSecrets: values.canAccessSecrets,
        },
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
      const data = await res.json();
      // 서버는 { agent: {...} } 형태로 반환
      return (data.agent ?? data) as Agent;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['admin-agents'] });
      qc.invalidateQueries({ queryKey: ['admin-agents-list'] });
      setSelectedId(result.id);
      setIsCreating(false);
      setErrorMsg('');
      setSuccessMsg('에이전트 설정이 저장되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
      // isDirty를 false로 초기화 — 저장된 값을 새 기준으로 reset
      reset({
        name: result.name,
        role: result.role,
        title: result.title ?? '',
        icon: result.icon ?? '',
        capabilities: result.capabilities ?? '',
        reportsTo: result.reportsTo ?? '',
        model: result.adapterConfig.model,
        fallbackModel: result.fallbackAdapterConfig?.model ?? '',
        budgetMonthlyCents: result.budgetMonthlyCents ?? 1000,
        skillId: result.skillId ?? '',
        ragEnabled: result.ragEnabled ?? true,
        heartbeatEnabled: result.runtimeConfig?.heartbeat?.enabled ?? false,
        heartbeatIntervalSec: result.runtimeConfig?.heartbeat?.intervalSec ?? 300,
        heartbeatMaxConcurrentRuns: result.runtimeConfig?.heartbeat?.maxConcurrentRuns ?? 1,
        heartbeatProactive: result.runtimeConfig?.heartbeat?.proactive ?? false,
        heartbeatDailyLimit: result.runtimeConfig?.heartbeat?.dailyLimit ?? 10,
        heartbeatPromptTemplate: result.runtimeConfig?.heartbeat?.promptTemplate ?? '',
        canHireDirect: result.permissions?.canHireDirect ?? false,
        canAssignTasks: result.permissions?.canAssignTasks ?? false,
        canAccessSecrets: result.permissions?.canAccessSecrets ?? false,
      });
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

  const statusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'pause' | 'resume' | 'terminate' }) => {
      const res = await fetch(`${API_BASE}/admin/agents/${id}/${action}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(action === 'pause' ? { reason: '관리자 수동 정지' } : {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `상태 변경 실패`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-agents'] });
      qc.invalidateQueries({ queryKey: ['admin-agents-list'] });
      setSuccessMsg('에이전트 상태가 변경되었습니다.');
      setTimeout(() => setSuccessMsg(''), 3000);
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
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-gray-800">
                  {isCreating ? '새 에이전트 등록' : '에이전트 설정'}
                </h2>
                {!isCreating && selectedId && (
                  <StatusBadge status={agents.find((a) => a.id === selectedId)?.status ?? 'idle'} />
                )}
              </div>
              <div className="flex items-center gap-2">
                {successMsg && (
                  <span className="text-xs text-green-600 font-medium animate-fade-in"> {successMsg}</span>
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

              {/* 표시 직함 + 아이콘 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    표시 직함
                    <span className="ml-1 text-[10px] text-gray-400">(선택)</span>
                  </label>
                  <input
                    {...register('title', { maxLength: { value: 120, message: '120자 이하' } })}
                    type="text"
                    placeholder="예: AI 튜터 - Java 반"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    아이콘
                    <span className="ml-1 text-[10px] text-gray-400">(이모지 또는 ID)</span>
                  </label>
                  <input
                    {...register('icon', { maxLength: { value: 60, message: '60자 이하' } })}
                    type="text"
                    placeholder="예: 🤖"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              {/* 역량 설명 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  역량 설명
                  <span className="ml-1 text-[10px] text-gray-400">(다른 에이전트 위임 탐색용 · 800자 이하)</span>
                </label>
                <textarea
                  {...register('capabilities', { maxLength: { value: 800, message: '800자 이하로 입력하세요' } })}
                  rows={3}
                  placeholder="자연어로 이 에이전트가 무엇을 할 수 있는지 설명하세요."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
                {errors.capabilities && <p className="text-xs text-red-500 mt-1">{errors.capabilities.message}</p>}
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
                      {m.recommended?.includes(watchedRole) ? '  추천' : ''}
                    </option>
                  ))}
                </select>
                {MODELS.find((m) => m.value === watchedModel)?.recommended?.includes(watchedRole) && (
                  <p className="text-xs text-green-600 mt-1"> 이 역할에 권장되는 모델입니다.</p>
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
                  월 예산 한도
                  <span className="ml-1 text-[10px] text-gray-400">(센트 단위 · 100 = $1.00)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    {...register('budgetMonthlyCents', {
                      required: true,
                      min: { value: 0, message: '0 이상이어야 합니다' },
                      max: { value: 1_000_000, message: '$10,000 이하로 설정하세요' },
                      valueAsNumber: true,
                    })}
                    type="number"
                    step="100"
                    min="0"
                    max="1000000"
                    className="w-36 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <span className="text-xs text-gray-500">
                    = ${((watchedBudgetCents ?? 0) / 100).toFixed(2)} / 월
                  </span>
                </div>
                {errors.budgetMonthlyCents && (
                  <p className="text-xs text-red-500 mt-1">{errors.budgetMonthlyCents.message}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">
                  80% 도달 시 경고 알림 발송, 100% 도달 시 에이전트 일시정지됩니다.
                </p>
              </div>

              {/* 스킬 파일 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  커스텀 스킬 파일
                  <span className="ml-1 text-[10px] text-gray-400">(저장 즉시 AI 프롬프트에 반영 · 선택 사항)</span>
                </label>
                <select
                  {...register('skillId')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">— 커스텀 스킬 없음 (기본 스킬 사용) —</option>
                  {skills.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>

                {/* 기본 스킬 상태 표시 — 커스텀 스킬 미선택 시 */}
                {!watchedSkillId && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-blue-500 text-xs">🔒</span>
                      <span className="text-xs font-semibold text-blue-700">기본 스킬 장착 · 활성화 중</span>
                      <span className="ml-auto text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">해제 불가</span>
                    </div>
                    {DEFAULT_SKILL_DESC[watchedRole] && (
                      <p className="text-[11px] text-blue-600 leading-relaxed">
                        {DEFAULT_SKILL_DESC[watchedRole]}
                      </p>
                    )}
                    <p className="text-[10px] text-blue-400">
                      커스텀 스킬을 선택하면 이 기본 스킬을 덮어씁니다.
                    </p>
                  </div>
                )}

                {/* 커스텀 스킬 선택 시 오버라이드 안내 */}
                {watchedSkillId && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-green-100 bg-green-50 px-3 py-2">
                    <span className="text-green-500 text-xs">✅</span>
                    <span className="text-[11px] text-green-700">
                      커스텀 스킬이 기본 스킬을 덮어씁니다.
                    </span>
                  </div>
                )}
              </div>
            </fieldset>

            {/* ── 섹션: RAG 교재 검색 ── */}
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-100 w-full">
                RAG 교재 검색
              </legend>

              <div className="flex items-start gap-3">
                <label className="relative inline-flex items-center cursor-pointer mt-0.5">
                  <input
                    {...register('ragEnabled')}
                    type="checkbox"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-500 rounded-full peer-focus:ring-2 peer-focus:ring-blue-300 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:w-4 after:h-4 after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
                </label>
                <div>
                  <p className="text-sm text-gray-700 font-medium">교재 RAG 검색 사용</p>
                  {watchedRagEnabled ? (
                    <p className="text-[11px] text-blue-600 mt-0.5">
                      수강생 질문 시 업로드된 교재에서 관련 내용을 검색해 답변에 활용합니다.
                      OpenAI 임베딩 API 키가 필요합니다.
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      비활성화 시 교재 검색 없이 LLM 모델만으로 답변합니다.
                      OpenAI API 키가 없거나 교재를 사용하지 않는 에이전트에 권장합니다.
                    </p>
                  )}
                </div>
              </div>
            </fieldset>

            {/* ── 섹션: 하트비트 (런타임 구성) ── */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-100 w-full">
                하트비트 스케줄
              </legend>

              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    {...register('heartbeatEnabled')}
                    type="checkbox"
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-500 rounded-full peer-focus:ring-2 peer-focus:ring-blue-300 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:w-4 after:h-4 after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
                </label>
                <span className="text-sm text-gray-700">주기적 하트비트 실행</span>
                {watchedHeartbeatEnabled && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">활성화됨</span>
                )}
              </div>

              {watchedHeartbeatEnabled && (
                <div className="grid grid-cols-2 gap-3 pl-1">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">실행 간격 (초)</label>
                    <input
                      {...register('heartbeatIntervalSec', {
                        valueAsNumber: true,
                        min: { value: 30, message: '30초 이상' },
                        max: { value: 86400, message: '86400초(1일) 이하' },
                      })}
                      type="number"
                      step="30"
                      min="30"
                      max="86400"
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <p className="text-[10px] text-gray-400 mt-0.5">30 ~ 86400 (기본 300)</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">최대 동시 실행 수</label>
                    <input
                      {...register('heartbeatMaxConcurrentRuns', {
                        valueAsNumber: true,
                        min: { value: 1, message: '1 이상' },
                        max: { value: 5, message: '5 이하' },
                      })}
                      type="number"
                      min="1"
                      max="5"
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <p className="text-[10px] text-gray-400 mt-0.5">1 ~ 5 (기본 1)</p>
                  </div>
                </div>
              )}

              {/* 자율 발화 (프로액티브 Heartbeat) */}
              {watchedHeartbeatEnabled && (
                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        {...register('heartbeatProactive')}
                        type="checkbox"
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-500 rounded-full peer-focus:ring-2 peer-focus:ring-blue-300 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:w-4 after:h-4 after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
                    </label>
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">자율 발화 활성화 (프로액티브)</p>
                      <p className="text-[10px] text-blue-500 dark:text-blue-400">수강생 입력 없이 에이전트가 먼저 메시지를 발화합니다. 수강생이 채팅 메뉴에서 개별 비활성화 가능, 기본값은 비활성화입니다.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">일일 최대 발화 횟수</label>
                      <input
                        {...register('heartbeatDailyLimit', { valueAsNumber: true, min: 1, max: 100 })}
                        type="number"
                        min="1"
                        max="100"
                        className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">비용 제어용 (기본 10회/일)</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">발화 프롬프트 템플릿</label>
                    <textarea
                      {...register('heartbeatPromptTemplate')}
                      rows={3}
                      placeholder="비워두면 기본 템플릿 사용: '오늘 과제 복습은 하셨나요? 궁금한 점이 있으면 언제든 질문하세요.'"
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-0.5">에이전트가 자율 발화 시 사용할 System Prompt 템플릿입니다.</p>
                  </div>
                </div>
              )}

              {!watchedHeartbeatEnabled && (
                <p className="text-[11px] text-gray-400">
                  활성화하면 에이전트가 설정한 간격으로 자동 실행됩니다.
                </p>
              )}
            </fieldset>

            {/* ── 섹션: 자율 권한 ── */}
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wider pb-1 border-b border-gray-100 w-full">
                자율 권한
              </legend>
              <p className="text-[11px] text-gray-400">이 에이전트가 자율적으로 수행할 수 있는 작업을 설정합니다.</p>

              {[
                { field: 'canHireDirect' as const, label: '직접 고용 권한', desc: '하위 에이전트를 직접 생성·배정할 수 있습니다.' },
                { field: 'canAssignTasks' as const, label: '작업 배정 권한', desc: '다른 에이전트에게 태스크를 위임할 수 있습니다.' },
                { field: 'canAccessSecrets' as const, label: '기밀 접근 권한', desc: 'API 키 등 기관 기밀 값을 읽을 수 있습니다.' },
              ].map(({ field, label, desc }) => (
                <label key={field} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    {...register(field)}
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-blue-600 rounded"
                  />
                  <div>
                    <p className="text-sm text-gray-700 group-hover:text-gray-900">{label}</p>
                    <p className="text-[10px] text-gray-400">{desc}</p>
                  </div>
                </label>
              ))}
            </fieldset>

            {/* 구분선 + 상태 관리 및 위험 영역 */}
            {!isCreating && selectedId && (() => {
              const agent = agents.find((a) => a.id === selectedId);
              if (!agent) return null;

              return (
                <div className="border-t border-gray-100 pt-4 space-y-6">
                  {/* 상태 제어 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">상태 제어</p>
                      <StatusBadge status={agent.status ?? 'idle'} />
                    </div>
                    <div className="flex items-center gap-2">
                      {agent.status !== 'terminated' ? (
                        <>
                          {agent.status === 'paused' ? (
                            <button
                              type="button"
                              onClick={() => statusMutation.mutate({ id: agent.id, action: 'resume' })}
                              disabled={statusMutation.isPending}
                              className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-100 transition disabled:opacity-50"
                            >
                              ▶️ 실행 재개
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => statusMutation.mutate({ id: agent.id, action: 'pause' })}
                              disabled={statusMutation.isPending}
                              className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition disabled:opacity-50"
                            >
                              ⏸️ 수동 일시정지
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`"${agent.name}" 에이전트를 영구 종료하시겠습니까?\n종료된 에이전트는 다시 실행할 수 없습니다.`)) {
                                statusMutation.mutate({ id: agent.id, action: 'terminate' });
                              }
                            }}
                            disabled={statusMutation.isPending}
                            className="text-xs text-gray-600 border border-gray-200 bg-gray-50 px-3 py-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-800 transition disabled:opacity-50 ml-auto"
                          >
                            ⏹️ 영구 종료
                          </button>
                        </>
                      ) : (
                        <p className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 px-3 py-2 rounded-lg w-full">
                          이 시스템 논리 객체는 영구 종료(Terminated) 상태로 전환되었으며 상태를 변경할 수 없습니다.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 삭제 제어 (Soft Delete) */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-2 uppercase tracking-wider">위험 영역 / 시스템 삭제</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`"${agent.name}" 에이전트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                          deleteMutation.mutate(selectedId);
                        }
                      }}
                      className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg hover:bg-red-100 transition"
                    >
                      🗑️ 에이전트 영구 삭제
                    </button>
                  </div>
                </div>
              );
            })()}
          </form>
        ) : (
          /* 선택 전 빈 상태 */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-8">
            <span className="text-5xl"></span>
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
