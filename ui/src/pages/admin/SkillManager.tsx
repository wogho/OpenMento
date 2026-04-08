/**
 * Phase 3-4 — 스킬 파일 관리 페이지
 *
 * 레이아웃:
 *   좌측 (1/3) — 스킬 목록 + 생성/삭제 CRUD
 *   우측 (2/3) — Split-pane 마크다운 에디터 (편집 / 미리보기)
 *
 * API:
 *   GET    /admin/skills              — 목록 조회
 *   POST   /admin/skills              — 신규 생성
 *   PUT    /admin/skills/:id          — 저장 + 캐시 무효화 (즉시 반영)
 *   DELETE /admin/skills/:id          — 삭제
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MDEditor from '@uiw/react-md-editor';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/* ─────────────────────────────── 타입 ─────────────────────────────── */

interface Skill {
  id: string;
  name: string;
  markdown: string;
  agentId: string | null;
  sourceRef: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}

interface SkillListItem {
  id: string;
  name: string;
  agentId: string | null;
  sourceRef: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}

interface Agent {
  id: string;
  name: string;
  role: string;
}

/* ─────────────────── 버전 이력 배지 ─────────────────── */

function VersionBadge({ skill }: { skill: SkillListItem }) {
  const dateStr = new Date(skill.updatedAt).toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div className="flex flex-col gap-0.5 text-xs text-gray-400">
      <span>{dateStr} 수정</span>
      {skill.updatedBy && <span>by {skill.updatedBy}</span>}
      {skill.sourceRef && (
        <span className="font-mono bg-gray-100 px-1 rounded">
          {skill.sourceRef.slice(0, 7)}
        </span>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   메인 컴포넌트
══════════════════════════════════════════════════════════════════════ */

export default function SkillManager() {
  const { token } = useAuth();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftMd, setDraftMd] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // H-3: GitHub 동기화 모달 상태
  const [isGhModalOpen, setIsGhModalOpen] = useState(false);
  const [ghRawUrl, setGhRawUrl] = useState('');
  const [ghTitle, setGhTitle] = useState('');
  const [ghAgentId, setGhAgentId] = useState('');
  const [draftName, setDraftName] = useState<string>('');
  const [draftAgentId, setDraftAgentId] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');

  /* ── 이탈 방지: isDirty 상태에서 브라우저 새로고침/닫기 경고 ── */
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  /* ── 스킬 목록 조회 ── */
  const { data: skills = [], isLoading } = useQuery<SkillListItem[]>({
    queryKey: ['admin-skills'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('스킬 목록 조회 실패');
      return res.json() as Promise<SkillListItem[]>;
    },
    staleTime: 30_000,
  });

  /* ── 선택된 스킬 상세 조회 ── */
  const { data: selectedSkill } = useQuery<Skill>({
    queryKey: ['admin-skill-detail', selectedId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills/${selectedId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('스킬 상세 조회 실패');
      return res.json() as Promise<Skill>;
    },
    enabled: !!selectedId,
    staleTime: 0,
  });

  /* ── 에이전트 목록 조회 (드롭다운용) ── */
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['admin-agents-list'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('에이전트 목록 조회 실패');
      return res.json() as Promise<Agent[]>;
    },
    staleTime: 60_000,
  });

  /* ── 스킬 선택 시 초기화 ── */
  const handleSelect = (skill: SkillListItem) => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 정말 이동하시겠습니까?')) return;
    setSelectedId(skill.id);
    setIsDirty(false);
    setSaveSuccess(false);
  };

  /* selectedSkill 로드 완료 시 draft 동기화 */
  if (selectedSkill && selectedSkill.id === selectedId && !isDirty) {
    if (draftMd !== selectedSkill.markdown) setDraftMd(selectedSkill.markdown);
    if (draftName !== selectedSkill.name) setDraftName(selectedSkill.name);
    if (draftAgentId !== (selectedSkill.agentId ?? '')) setDraftAgentId(selectedSkill.agentId ?? '');
  }

  /* ── 저장 (PUT) ── */
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills/${selectedId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: draftName,
          markdown: draftMd,
          agentId: draftAgentId || null,
        }),
      });
      if (!res.ok) throw new Error('저장 실패');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-skills'] });
      qc.invalidateQueries({ queryKey: ['admin-skill-detail', selectedId] });
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  /* ── 신규 생성 (POST) ── */
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newSkillName.trim(),
          markdown: `# ${newSkillName.trim()}\n\n여기에 스킬 내용을 작성하세요.`,
        }),
      });
      if (!res.ok) throw new Error('생성 실패');
      return res.json() as Promise<Skill>;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['admin-skills'] });
      setSelectedId(created.id);
      setDraftMd(created.markdown);
      setDraftName(created.name);
      setDraftAgentId('');
      setIsDirty(false);
      setIsCreating(false);
      setNewSkillName('');
    },
  });

  /* ── 삭제 (DELETE) ── */
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/admin/skills/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? '삭제 실패');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-skills'] });
      setSelectedId(null);
      setDraftMd('');
      setDraftName('');
      setDraftAgentId('');
      setIsDirty(false);
      setDeleteError(null);
    },
    onError: (e: Error) => {
      setDeleteError(e.message);
    },
  });

  /* ── H-3: GitHub 동기화 (POST /admin/skills/import-github) ── */
  const importGhMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills/import-github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rawUrl: ghRawUrl.trim(),
          title: ghTitle.trim(),
          agentId: ghAgentId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'GitHub 가져오기 실패');
      }
      return res.json() as Promise<{ skill: Skill }>;
    },
    onSuccess: ({ skill }) => {
      qc.invalidateQueries({ queryKey: ['admin-skills'] });
      setSelectedId(skill.id);
      setDraftMd(skill.markdown);
      setDraftName(skill.name);
      setDraftAgentId(skill.agentId ?? '');
      setIsDirty(false);
      setIsGhModalOpen(false);
      setGhRawUrl('');
      setGhTitle('');
      setGhAgentId('');
    },
  });

  /* ── 에디터 변경 핸들러 ── */
  const handleMdChange = (value: string | undefined) => {
    setDraftMd(value ?? '');
    setIsDirty(true);
    setSaveSuccess(false);
  };

  const handleNameChange = (v: string) => {
    setDraftName(v);
    setIsDirty(true);
  };

  const handleAgentChange = (v: string) => {
    setDraftAgentId(v);
    setIsDirty(true);
  };

  /* ════════════════════════════════ JSX ═══════════════════════════════ */

  return (<>
    <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">

      {/* ══ 좌측 — 스킬 목록 패널 ══ */}
      <aside className="w-64 shrink-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* 헤더 + 생성/GitHub 버튼 */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100 bg-gray-50 gap-1">
          <span className="text-sm font-semibold text-gray-700 shrink-0">스킬 파일</span>
          <div className="flex items-center gap-1">
            {/* H-3: GitHub 동기화 버튼 */}
            <button
              onClick={() => setIsGhModalOpen(true)}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-200 transition"
              title="GitHub Raw URL에서 스킬 가져오기"
            >
              🔄
            </button>
            <button
              onClick={() => {
                if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 새 스킬을 만드시겠습니까?')) return;
                setIsCreating(true);
              }}
              className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              + 새 스킬
            </button>
          </div>
        </div>

        {/* 신규 생성 입력 */}
        {isCreating && (
          <div className="px-3 py-2 bg-blue-50 border-b border-blue-100 space-y-2">
            <input
              type="text"
              value={newSkillName}
              onChange={(e) => setNewSkillName(e.target.value)}
              placeholder="스킬 이름 입력"
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newSkillName.trim()) createMutation.mutate();
                if (e.key === 'Escape') { setIsCreating(false); setNewSkillName(''); }
              }}
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!newSkillName.trim() || createMutation.isPending}
                className="flex-1 text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending ? '생성 중…' : '생성'}
              </button>
              <button
                onClick={() => { setIsCreating(false); setNewSkillName(''); }}
                className="text-xs text-gray-500 px-2 py-1 rounded hover:bg-gray-100"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* 스킬 리스트 */}
        <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {isLoading && (
            <li className="p-4 text-sm text-gray-400 text-center">불러오는 중…</li>
          )}
          {!isLoading && skills.length === 0 && (
            <li className="p-4 text-sm text-gray-400 text-center">
              스킬 파일이 없습니다.<br />
              <span className="text-blue-500 cursor-pointer" onClick={() => {
                if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 새 스킬을 만드시겠습니까?')) return;
                setIsCreating(true);
              }}>새로 만들기</span>
            </li>
          )}
          {skills.map((skill) => (
            <li
              key={skill.id}
              onClick={() => handleSelect(skill)}
              className={`px-4 py-3 cursor-pointer transition group ${
                selectedId === skill.id
                  ? 'bg-blue-50 border-l-2 border-blue-500'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{skill.name}</p>
                  {skill.agentId && (
                    <p className="text-xs text-blue-500 truncate mt-0.5">
                      {agents.find((a) => a.id === skill.agentId)?.name ?? '에이전트 연결됨'}
                    </p>
                  )}
                  <VersionBadge skill={skill} />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteError(null);
                    if (confirm(`"${skill.name}" 스킬을 삭제하시겠습니까?`)) {
                      deleteMutation.mutate(skill.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs p-1 rounded transition"
                  title="삭제"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>

        {/* H-1: 삭제 의존성 에러 배너 */}
        {deleteError && (
          <div className="px-3 py-2 bg-red-50 border-t border-red-100 text-[11px] text-red-600 leading-snug">
            {deleteError}
            <button onClick={() => setDeleteError(null)} className="ml-1 underline">닫기</button>
          </div>
        )}
      </aside>

      {/* ══ 우측 — 에디터 패널 ══ */}
      <section className="flex-1 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
        {selectedId ? (
          <>
            {/* ── 상단 메타 정보 + 저장 버튼 ── */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
              {/* 스킬 이름 */}
              <input
                type="text"
                value={draftName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="text-sm font-semibold text-gray-800 border-b border-transparent hover:border-gray-300 focus:border-blue-400 bg-transparent outline-none px-1 py-0.5 min-w-0 max-w-[200px]"
                placeholder="스킬 이름"
              />

              {/* 에이전트 연결 드롭다운 */}
              <select
                value={draftAgentId}
                onChange={(e) => handleAgentChange(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">— 에이전트 미연결 —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.role})
                  </option>
                ))}
              </select>

              {/* H-2: 토큰 카운터 + 저장 버튼 */}
              <div className="ml-auto flex items-center gap-2">
                {(() => {
                  const est = Math.round(draftMd.length * 0.7);
                  const color = est > 1500 ? 'text-red-500' : est > 1000 ? 'text-orange-500' : 'text-gray-400';
                  return (
                    <span className={`text-[11px] font-mono tabular-nums ${color}`} title="예상 토큰 수 (글자 수 × 0.7 근사치), 권장 1,000 이내">
                      ~{est.toLocaleString()}tok
                      {est > 1000 && <span className="ml-1">{est > 1500 ? '🔴' : '🟠'}</span>}
                    </span>
                  );
                })()}
                {saveSuccess && (
                  <span className="text-xs text-green-600 font-medium animate-fade-in">
                    ✓ AI 강사에 즉시 반영됨
                  </span>
                )}
                {saveMutation.isError && (
                  <span className="text-xs text-red-500">저장 실패</span>
                )}
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={!isDirty || saveMutation.isPending}
                  className={`flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg font-medium transition
                    ${isDirty
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                >
                  {saveMutation.isPending ? (
                    <span className="animate-spin text-sm">⏳</span>
                  ) : (
                    <span>💾</span>
                  )}
                  저장하고 AI 강사에 즉시 반영
                </button>
              </div>
            </div>

            {/* ── 마크다운 에디터 (Split-pane: 편집 + 미리보기) ── */}
            <div className="flex-1 overflow-hidden" data-color-mode="light">
              <MDEditor
                value={draftMd}
                onChange={handleMdChange}
                height="100%"
                preview="live"
                visibleDragbar={false}
                style={{ borderRadius: 0, border: 'none', height: '100%' }}
                textareaProps={{
                  placeholder: '여기에 스킬 마크다운을 입력하세요.\n\n예시:\n## 코드 리뷰 지침\n- 정답 코드를 직접 제공하지 않는다\n- 소크라테스 방식으로 질문을 유도한다',
                }}
              />
            </div>
          </>
        ) : (
          /* 선택 전 빈 상태 */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
            <span className="text-5xl">📝</span>
            <p className="font-medium text-gray-500">좌측에서 스킬 파일을 선택하세요</p>
            <p className="text-xs text-center max-w-xs">
              스킬 파일은 AI 강사의 시스템 프롬프트에 즉시 주입됩니다.<br />
              Java반 / Python반 전환도 스킬 파일 교체만으로 완료됩니다.
            </p>
            <button
              onClick={() => {
                if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 새 스킬을 만드시겠습니까?')) return;
                setIsCreating(true);
              }}
              className="mt-2 text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              + 첫 번째 스킬 파일 만들기
            </button>
          </div>
        )}
      </section>
    </div>

    {/* ══ H-3: GitHub 동기화 모달 ══ */}
    {isGhModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
          <h3 className="text-base font-bold text-gray-800">🔄 GitHub에서 스킬 가져오기</h3>
          <p className="text-xs text-gray-500">
            GitHub의 Raw 파일 URL을 입력하면 마크다운 내용을 자동으로 가져옵니다.
            <br />
            <span className="font-mono bg-gray-100 px-1 rounded text-[10px]">https://raw.githubusercontent.com/org/repo/main/skills/java.md</span>
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">스킬 이름 *</label>
              <input
                type="text"
                value={ghTitle}
                onChange={(e) => setGhTitle(e.target.value)}
                placeholder="예: Java Spring 코딩 지침"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">GitHub Raw URL *</label>
              <input
                type="url"
                value={ghRawUrl}
                onChange={(e) => setGhRawUrl(e.target.value)}
                placeholder="https://raw.githubusercontent.com/..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">적용 에이전트 (선택)</label>
              <select
                value={ghAgentId}
                onChange={(e) => setGhAgentId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">— 연결 안 함 —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                ))}
              </select>
            </div>
          </div>

          {importGhMutation.isError && (
            <p className="text-xs text-red-500">{(importGhMutation.error as Error).message}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setIsGhModalOpen(false);
                setGhRawUrl('');
                setGhTitle('');
                setGhAgentId('');
                importGhMutation.reset();
              }}
              className="text-sm px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              취소
            </button>
            <button
              onClick={() => importGhMutation.mutate()}
              disabled={!ghTitle.trim() || !ghRawUrl.trim() || importGhMutation.isPending}
              className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition font-medium"
            >
              {importGhMutation.isPending ? '가져오는 중…' : '가져오기'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>);
}
