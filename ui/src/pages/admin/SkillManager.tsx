/**
 * Phase 3-4 — 스킬 파일 관리 페이지 (파일 탐색기 UI)
 *
 * 레이아웃:
 *   좌측 — 파일 탐색기 (폴더 = tags[0] 카테고리, 스킬 = 파일)
 *   우측 — Split-pane 마크다운 에디터
 *
 * 폴더 규칙: tags[0] = 카테고리(폴더명), tags[1:] = 검색 태그
 */

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, Folder, FolderOpen,
  FileText, Plus, Trash2, FolderPlus,
} from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

/* ─────────────────────────────── 타입 ─────────────────────────────── */

interface Skill {
  id: string;
  title: string;
  tags?: string[];
  markdown: string;
  agentId: string | null;
  courseId?: string | null;
  sourceRef: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}

interface SkillListItem {
  id: string;
  title: string;
  tags?: string[];
  agentId: string | null;
  courseId?: string | null;
  sourceRef: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}

interface Agent {
  id: string;
  name: string;
  role: string;
}

/* ══════════════════════════════════════════════════════════════════════
   메인 컴포넌트
══════════════════════════════════════════════════════════════════════ */

export default function SkillManager() {
  const { token } = useAuth();
  const qc = useQueryClient();

  /* ─── 선택/편집 상태 ─── */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftMd, setDraftMd] = useState<string>('');
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [draftAgentId, setDraftAgentId] = useState<string>('');
  const [draftCategory, setDraftCategory] = useState<string>('');   // tags[0]
  const [draftTagsStr, setDraftTagsStr] = useState<string>('');      // tags[1:]
  const [isDirty, setIsDirty] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /* ─── 탐색기 상태 ─── */
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [virtualFolders, setVirtualFolders] = useState<string[]>([]);  // 빈 폴더 (로컬)
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingInFolder, setCreatingInFolder] = useState<string | null>(null); // null = 비활성, '__root__' = 루트
  const [newSkillTitle, setNewSkillTitle] = useState('');

  /* ─── GitHub 모달 상태 ─── */
  const [isGhModalOpen, setIsGhModalOpen] = useState(false);
  const [ghRawUrl, setGhRawUrl] = useState('');
  const [ghTitle, setGhTitle] = useState('');
  const [ghAgentId, setGhAgentId] = useState('');

  /* ── 이탈 방지 ── */
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  /* ── 스킬 목록 ── */
  const { data: skills = [], isLoading } = useQuery<SkillListItem[]>({
    queryKey: ['admin-skills'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/skills`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('스킬 목록 조회 실패');
      const data = await res.json();
      return Array.isArray(data) ? data : (data.skills ?? []);
    },
    staleTime: 30_000,
  });

  /* ── 선택된 스킬 상세 ── */
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

  /* ── 에이전트 목록 ── */
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['admin-agents-list'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('에이전트 목록 조회 실패');
      const data = await res.json();
      return Array.isArray(data) ? data : (data.agents ?? []);
    },
    staleTime: 60_000,
  });

  /* ──────────────────────────────────────────
     폴더 트리 계산
     skills의 tags[0]으로부터 폴더 구조 도출
  ────────────────────────────────────────── */
  const { folderMap, rootSkills, categoryList } = useMemo(() => {
    const map = new Map<string, SkillListItem[]>();
    const root: SkillListItem[] = [];
    const cats = new Set<string>();

    for (const skill of skills) {
      const cat = skill.tags?.[0];
      if (cat) {
        cats.add(cat);
        const arr = map.get(cat) ?? [];
        arr.push(skill);
        map.set(cat, arr);
      } else {
        root.push(skill);
      }
    }
    // 가상(빈) 폴더 추가
    for (const vf of virtualFolders) {
      if (!map.has(vf)) map.set(vf, []);
      cats.add(vf);
    }

    return {
      folderMap: map,
      rootSkills: root,
      categoryList: Array.from(cats).sort((a, b) => a.localeCompare(b, 'ko')),
    };
  }, [skills, virtualFolders]);

  /* 폴더 이름 목록(정렬) */
  const folderNames = useMemo(
    () => Array.from(folderMap.keys()).sort((a, b) => a.localeCompare(b, 'ko')),
    [folderMap],
  );

  /* ── 스킬 선택 ── */
  const handleSelect = (skill: SkillListItem) => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 정말 이동하시겠습니까?')) return;
    setSelectedId(skill.id);
    setIsDirty(false);
    setSaveSuccess(false);
    // 해당 스킬의 폴더를 자동 열기
    const cat = skill.tags?.[0];
    if (cat) setExpandedFolders(prev => new Set([...prev, cat]));
  };

  /* selectedSkill 로드 시 draft 동기화 */
  useEffect(() => {
    if (selectedSkill && selectedSkill.id === selectedId && !isDirty) {
      setDraftMd(selectedSkill.markdown || '');
      setDraftTitle(selectedSkill.title || '');
      setDraftAgentId(selectedSkill.agentId ?? '');
      setDraftCategory(selectedSkill.tags?.[0] ?? '');
      setDraftTagsStr((selectedSkill.tags?.slice(1) ?? []).join(', '));
    }
  }, [selectedSkill, selectedId, isDirty]);

  /* 폴더 접기/펴기 */
  const toggleFolder = (name: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /* 빈 폴더 삭제 (가상 폴더만) */
  const handleDeleteEmptyFolder = (name: string) => {
    setVirtualFolders(prev => prev.filter(f => f !== name));
  };

  /* 해당 폴더에 스킬 추가 시작 */
  const handleAddSkillInFolder = (folderName: string) => {
    if (isDirty && !window.confirm('저장하지 않은 내용이 있습니다. 새 스킬을 만드시겠습니까?')) return;
    setCreatingInFolder(folderName);
    setNewSkillTitle('');
    setExpandedFolders(prev => new Set([...prev, folderName]));
  };

  /* ── 저장 (PUT) ── */
  const saveMutation = useMutation({
    mutationFn: async () => {
      const tags = [
        ...(draftCategory.trim() ? [draftCategory.trim()] : []),
        ...draftTagsStr.split(',').map(t => t.trim()).filter(Boolean),
      ];
      const res = await fetch(`${API_BASE}/admin/skills/${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: draftTitle,
          markdown: draftMd,
          agentId: draftAgentId || null,
          tags,
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
      const folder = creatingInFolder;
      const tags = folder && folder !== '__root__' ? [folder] : [];
      const res = await fetch(`${API_BASE}/admin/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: newSkillTitle.trim(),
          markdown: `# ${newSkillTitle.trim()}\n\n여기에 스킬 내용을 작성하세요.`,
          tags,
        }),
      });
      if (!res.ok) throw new Error('생성 실패');
      const body = await res.json() as { skill?: Skill } | Skill;
      return ('skill' in body && body.skill ? body.skill : body) as Skill;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['admin-skills'] });
      setSelectedId(created.id);
      setDraftMd(created.markdown);
      setDraftTitle(created.title);
      setDraftAgentId('');
      setDraftCategory(created.tags?.[0] ?? '');
      setDraftTagsStr('');
      setIsDirty(false);
      setCreatingInFolder(null);
      setNewSkillTitle('');
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
      setDraftTitle('');
      setDraftAgentId('');
      setDraftCategory('');
      setDraftTagsStr('');
      setIsDirty(false);
      setDeleteError(null);
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  /* ── GitHub 동기화 ── */
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
      setDraftTitle(skill.title);
      setDraftAgentId(skill.agentId ?? '');
      setDraftCategory(skill.tags?.[0] ?? '');
      setDraftTagsStr((skill.tags?.slice(1) ?? []).join(', '));
      setIsDirty(false);
      setIsGhModalOpen(false);
      setGhRawUrl('');
      setGhTitle('');
      setGhAgentId('');
    },
  });

  /* ── 에디터 핸들러 ── */
  const handleMdChange = (v: string | undefined) => { setDraftMd(v ?? ''); setIsDirty(true); setSaveSuccess(false); };
  const handleNameChange = (v: string) => { setDraftTitle(v); setIsDirty(true); };
  const handleAgentChange = (v: string) => { setDraftAgentId(v); setIsDirty(true); };
  const handleCategoryChange = (v: string) => { setDraftCategory(v); setIsDirty(true); };
  const handleExtraTagsChange = (v: string) => { setDraftTagsStr(v); setIsDirty(true); };

  /* ─────────────────── 스킬 아이템 렌더링 ─────────────────── */
  const renderSkillItem = (skill: SkillListItem, indent = false) => (
    <div
      key={skill.id}
      onClick={() => handleSelect(skill)}
      className={`flex items-center gap-1.5 py-1.5 cursor-pointer group transition-colors
        ${indent ? 'pl-7 pr-2' : 'pl-3 pr-2'}
        ${selectedId === skill.id
          ? 'bg-blue-50 text-blue-700 border-l-2 border-blue-500'
          : 'text-gray-700 hover:bg-gray-50 border-l-2 border-transparent'}
      `}
    >
      <FileText size={13} className={`shrink-0 ${selectedId === skill.id ? 'text-blue-500' : 'text-gray-400'}`} />
      <span className="text-xs flex-1 min-w-0 truncate font-medium">{skill.title}</span>
      {skill.agentId && (
        <span className="text-[10px] text-blue-400 shrink-0 hidden group-hover:hidden">●</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDeleteError(null);
          if (confirm(`"${skill.title}" 스킬을 삭제하시겠습니까?`)) {
            deleteMutation.mutate(skill.id);
          }
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-red-400 shrink-0 transition"
        title="삭제"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );

  /* ─────────────────── 생성 입력 렌더링 ─────────────────── */
  const renderCreateInput = (folder: string) => (
    <div className={`py-1.5 space-y-1 ${folder !== '__root__' ? 'pl-7 pr-2' : 'px-2'}`}>
      <input
        type="text"
        value={newSkillTitle}
        onChange={(e) => setNewSkillTitle(e.target.value)}
        placeholder="스킬 파일 이름"
        className="w-full text-xs border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && newSkillTitle.trim()) createMutation.mutate();
          if (e.key === 'Escape') { setCreatingInFolder(null); setNewSkillTitle(''); }
        }}
        autoFocus
      />
      <div className="flex gap-1">
        <button
          onClick={() => createMutation.mutate()}
          disabled={!newSkillTitle.trim() || createMutation.isPending}
          className="flex-1 text-[11px] bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {createMutation.isPending ? '생성 중…' : '생성'}
        </button>
        <button
          onClick={() => { setCreatingInFolder(null); setNewSkillTitle(''); }}
          className="text-[11px] text-gray-500 px-2 py-0.5 rounded hover:bg-gray-100"
        >
          취소
        </button>
      </div>
    </div>
  );

  /* ════════════════════════════════ JSX ═══════════════════════════════ */

  return (<>
    <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">

      {/* ══ 좌측 — 파일 탐색기 패널 ══ */}
      <aside className="w-60 shrink-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden select-none">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-gray-50">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">스킬 탐색기</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsGhModalOpen(true)}
              className="p-1 rounded text-gray-500 hover:bg-gray-200 transition"
              title="GitHub에서 가져오기"
            >
              <span className="text-xs">🔄</span>
            </button>
            <button
              onClick={() => { setIsAddingFolder(true); setNewFolderName(''); }}
              className="p-1 rounded text-gray-500 hover:bg-gray-200 transition"
              title="새 폴더"
            >
              <FolderPlus size={14} />
            </button>
            <button
              onClick={() => handleAddSkillInFolder('__root__')}
              className="p-1 rounded text-blue-600 hover:bg-blue-50 transition"
              title="새 스킬 파일"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* 새 폴더 생성 입력 */}
        {isAddingFolder && (
          <div className="px-2 py-1.5 border-b border-gray-100 bg-yellow-50">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="폴더 이름"
              className="w-full text-xs border border-yellow-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400 bg-white"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  const name = newFolderName.trim();
                  if (!folderMap.has(name)) setVirtualFolders(prev => [...prev, name]);
                  setExpandedFolders(prev => new Set([...prev, name]));
                  setIsAddingFolder(false);
                  setNewFolderName('');
                }
                if (e.key === 'Escape') { setIsAddingFolder(false); setNewFolderName(''); }
              }}
              autoFocus
            />
            <p className="text-[10px] text-gray-400 mt-0.5 pl-1">Enter 확인 · Esc 취소</p>
          </div>
        )}

        {/* 로딩 */}
        {isLoading && (
          <div className="p-4 text-xs text-gray-400 text-center">불러오는 중…</div>
        )}

        {/* 트리 */}
        {!isLoading && (
          <div className="flex-1 overflow-y-auto py-1">

            {/* ── 폴더들 ── */}
            {folderNames.map((folderName) => {
              const folderSkills = folderMap.get(folderName) ?? [];
              const isExpanded = expandedFolders.has(folderName);
              const isEmpty = folderSkills.length === 0 && virtualFolders.includes(folderName);

              return (
                <div key={folderName}>
                  {/* 폴더 행 */}
                  <div
                    className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-gray-50 group"
                    onClick={() => toggleFolder(folderName)}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="text-gray-400 shrink-0" />
                      : <ChevronRight size={12} className="text-gray-400 shrink-0" />
                    }
                    {isExpanded
                      ? <FolderOpen size={14} className="text-yellow-500 shrink-0" />
                      : <Folder size={14} className="text-yellow-500 shrink-0" />
                    }
                    <span className="text-xs text-gray-700 font-semibold flex-1 min-w-0 truncate">
                      {folderName}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0 mr-1">
                      {folderSkills.length}
                    </span>
                    {/* 폴더에 스킬 추가 */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAddSkillInFolder(folderName); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-blue-100 text-blue-500 shrink-0 transition"
                      title="스킬 추가"
                    >
                      <Plus size={11} />
                    </button>
                    {/* 빈 폴더 삭제 */}
                    {isEmpty && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteEmptyFolder(folderName); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-red-400 shrink-0 transition"
                        title="빈 폴더 삭제"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>

                  {/* 폴더 펼침 — 스킬 목록 */}
                  {isExpanded && (
                    <div>
                      {creatingInFolder === folderName && renderCreateInput(folderName)}
                      {folderSkills.map(skill => renderSkillItem(skill, true))}
                      {folderSkills.length === 0 && creatingInFolder !== folderName && (
                        <div className="pl-8 pr-2 py-1 text-[11px] text-gray-400 italic">
                          스킬 없음
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── 루트 스킬 (카테고리 없음) ── */}
            {(rootSkills.length > 0 || creatingInFolder === '__root__') && (
              <div className="mt-1">
                {folderNames.length > 0 && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    공통 스킬
                  </div>
                )}
                {creatingInFolder === '__root__' && renderCreateInput('__root__')}
                {rootSkills.map(skill => renderSkillItem(skill, false))}
              </div>
            )}

            {/* 완전히 비어있을 때 */}
            {skills.length === 0 && !isLoading && creatingInFolder === null && (
              <div className="p-4 text-xs text-gray-400 text-center leading-relaxed">
                스킬 파일이 없습니다.
                <br />
                <button
                  onClick={() => handleAddSkillInFolder('__root__')}
                  className="text-blue-500 hover:underline mt-1 block mx-auto"
                >
                  + 첫 번째 스킬 만들기
                </button>
              </div>
            )}
          </div>
        )}

        {/* 삭제 에러 배너 */}
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
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50 shrink-0">
              {/* 스킬 이름 */}
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => handleNameChange(e.target.value)}
                className="text-sm font-semibold text-gray-800 border-b border-transparent hover:border-gray-300 focus:border-blue-400 bg-transparent outline-none px-1 py-0.5 min-w-0 max-w-[200px]"
                placeholder="스킬 이름"
              />

              {/* 카테고리 (tags[0]) */}
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400">📂</span>
                <input
                  type="text"
                  value={draftCategory}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  placeholder="카테고리"
                  list="category-datalist"
                  className="text-xs border border-gray-200 rounded px-2 py-1 w-28 text-gray-600 focus:outline-none focus:ring-1 focus:ring-yellow-400 bg-white"
                />
                <datalist id="category-datalist">
                  {categoryList.map(cat => <option key={cat} value={cat} />)}
                </datalist>
              </div>

              {/* 에이전트 연결 드롭다운 */}
              <select
                value={draftAgentId}
                onChange={(e) => handleAgentChange(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">— 에이전트 미연결 —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                ))}
              </select>

              {/* 추가 태그 (tags[1:]) */}
              <input
                type="text"
                value={draftTagsStr}
                onChange={(e) => handleExtraTagsChange(e.target.value)}
                placeholder="태그 (쉼표 구분)"
                className="text-xs border border-gray-200 rounded px-2 py-1 w-32 text-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white"
              />

              {/* 토큰 카운터 + 저장 버튼 */}
              <div className="ml-auto flex items-center gap-2">
                {(() => {
                  const est = Math.round(draftMd.length * 0.7);
                  const color = est > 1500 ? 'text-red-500' : est > 1000 ? 'text-orange-500' : 'text-gray-400';
                  return (
                    <span className={`text-[11px] font-mono tabular-nums ${color}`} title="예상 토큰 수, 권장 1,000 이내">
                      ~{est.toLocaleString()}tok
                      {est > 1000 && <span className="ml-1">{est > 1500 ? '🔴' : '🟠'}</span>}
                    </span>
                  );
                })()}
                {saveSuccess && (
                  <span className="text-xs text-green-600 font-medium">✓ AI 강사에 즉시 반영됨</span>
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
                  {saveMutation.isPending ? <span className="animate-spin text-sm">⏳</span> : <span>💾</span>}
                  저장하고 AI 강사에 즉시 반영
                </button>
              </div>
            </div>

            {/* ── 마크다운 에디터 ── */}
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
            <p className="font-medium text-gray-500">좌측 탐색기에서 스킬 파일을 선택하세요</p>
            <p className="text-xs text-center max-w-xs">
              폴더로 카테고리를 구성하고, 스킬 파일을 클릭해 편집하세요.<br />
              저장 즉시 AI 강사에 반영됩니다.
            </p>
            <button
              onClick={() => handleAddSkillInFolder('__root__')}
              className="mt-2 text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              + 첫 번째 스킬 파일 만들기
            </button>
          </div>
        )}
      </section>
    </div>

    {/* ══ GitHub 동기화 모달 ══ */}
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
