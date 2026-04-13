/**
 * OrgChart — 5계층 조직도
 * 강사(파란색) → 과목(초록색) → skills(보라색) → 에이전트(주황색) / 수강생(분홍색)
 *
 * - 관리자: 모든 강사의 조직도 선택 가능 (강사 선택 드롭다운)
 * - 강사: 본인 조직도만 조회
 * - 수강생은 과목에서 직접 연결 (layer 5)
 * - 미연결 자산(Unassigned): 과목에 미배치 스킬 / 스킬에 미배치 에이전트를 별도 패널로 표시
 * - 필터 토글: 미연결 자산 숨기기/보이기
 * - Pan + Zoom 인터랙션 (마우스 드래그 + 휠)
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, ChevronDown, Eye, EyeOff, Lock, Globe, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const API = import.meta.env.VITE_API_URL ?? '/api';

// ── 상수 ────────────────────────────────────────────────────────────────────
const NODE_W = 172;
const NODE_H = 80;
const COL_GAP = 40;
const ROW_GAP = 80;
const PADDING = 60;

// ── 색상 테마 ────────────────────────────────────────────────────────────────
const COLORS = {
  instructor: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' },
  course:     { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' },
  skill:      { bg: '#faf5ff', border: '#a855f7', text: '#7e22ce' },
  agent:      { bg: '#fff7ed', border: '#f97316', text: '#c2410c' },  student:    { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' },} as const;

const AGENT_STATUS_COLOR: Record<string, string> = {
  running: '#22d3ee', idle: '#a3a3a3', paused: '#facc15', error: '#f87171', terminated: '#6b7280',
};

const ROLE_LABELS: Record<string, string> = {
  orchestrator: '오케스트레이터', ews_monitor: 'EWS 모니터', ai_instructor: 'AI 강사',
  ai_tutor: 'AI 튜터', mental_care: '멘탈케어', portfolio_reviewer: '포트폴리오 심사', data_retention: '데이터 보존',
};

// ── 타입 ────────────────────────────────────────────────────────────────────
type LayerType = 'instructor' | 'course' | 'skill' | 'agent' | 'student';

interface OrgAgent { id: string; name: string; role: string; status: string; title: string | null; isPrivate: boolean; scope: string; model?: string | null; }
interface OrgSkill  { id: string; title: string; isPrivate: boolean; scope: string; tags: string[] | null; agent: OrgAgent | null; }
interface OrgStudent { id: string; displayName: string | null; email: string | null; }
interface OrgCourse { id: string; name: string; subject: string; skills: OrgSkill[]; students: OrgStudent[]; }
interface OrgInstructor { id: string; name: string; role: string; courses: OrgCourse[]; }
interface OrgFull { tree: OrgInstructor[]; unassigned: { skills: OrgSkill[]; agents: OrgAgent[]; }; }
interface Instructor { id: string; name: string; role: string; }

interface LayoutNode {
  id: string; label: string; sublabel: string; layer: LayerType;
  x: number; y: number; isPrivate: boolean; scope: string; status?: string;
  model?: string | null;
  parentId?: string; childIds: string[];
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
function edgeColor(to: LayoutNode): string {
  return COLORS[to.layer].border;
}

// ── 5계층 레이아웃 계산 ──────────────────────────────────────────────────────
function buildLayout(tree: OrgInstructor[]): { nodes: LayoutNode[]; edges: { from: string; to: string }[] } {
  const nodes: LayoutNode[] = [];
  const edges: { from: string; to: string }[] = [];
  let globalX = PADDING;

  for (const ins of tree) {
    const insNodeId = `ins-${ins.id}`;
    const courseStartX = globalX;
    let courseX = globalX;
    const insChildIds: string[] = [];

    if (ins.courses.length === 0) {
      nodes.push({ id: insNodeId, label: ins.name, sublabel: '강사', layer: 'instructor', x: globalX, y: PADDING, isPrivate: false, scope: 'global', childIds: [] });
      globalX += NODE_W + COL_GAP * 3;
      continue;
    }

    for (const course of ins.courses) {
      const courseNodeId = `course-${course.id}`;
      insChildIds.push(courseNodeId);
      const skillStartX = courseX;
      let skillX = courseX;
      const courseChildIds: string[] = [];

      if (course.skills.length === 0) {
        nodes.push({ id: courseNodeId, label: course.name, sublabel: course.subject, layer: 'course', x: courseX, y: PADDING + NODE_H + ROW_GAP, isPrivate: false, scope: 'global', parentId: insNodeId, childIds: [] });
        edges.push({ from: insNodeId, to: courseNodeId });
        // 수강생 layer 5
        const noSkillStudents = course.students ?? [];
        let stX = courseX;
        for (const st of noSkillStudents) {
          const sid = `student-${st.id}-${course.id}`;
          nodes.push({ id: sid, label: st.displayName ?? '(이름 없음)', sublabel: st.email ?? '', layer: 'student', x: stX, y: PADDING + (NODE_H + ROW_GAP) * 4, isPrivate: false, scope: 'global', parentId: courseNodeId, childIds: [] });
          edges.push({ from: courseNodeId, to: sid });
          stX += NODE_W + COL_GAP;
        }
        courseX = Math.max(courseX + NODE_W + COL_GAP, stX + COL_GAP);
        continue;
      }

      for (const skill of course.skills) {
        const skillNodeId = `skill-${skill.id}`;
        courseChildIds.push(skillNodeId);
        const agentChildIds: string[] = [];

        nodes.push({ id: skillNodeId, label: skill.title, sublabel: `scope: ${skill.scope}`, layer: 'skill', x: skillX, y: PADDING + (NODE_H + ROW_GAP) * 2, isPrivate: skill.isPrivate, scope: skill.scope, parentId: courseNodeId, childIds: [] });
        edges.push({ from: courseNodeId, to: skillNodeId });

        if (skill.agent) {
          const agentNodeId = `agent-${skill.agent.id}`;
          agentChildIds.push(agentNodeId);
          nodes.push({ id: agentNodeId, label: skill.agent.name, sublabel: ROLE_LABELS[skill.agent.role] ?? skill.agent.role, layer: 'agent', x: skillX, y: PADDING + (NODE_H + ROW_GAP) * 3, isPrivate: skill.agent.isPrivate, scope: skill.agent.scope, status: skill.agent.status, model: skill.agent.model ?? null, parentId: skillNodeId, childIds: [] });
          edges.push({ from: skillNodeId, to: agentNodeId });
          const sn = nodes.find(n => n.id === skillNodeId);
          if (sn) sn.childIds = agentChildIds;
        }
        skillX += NODE_W + COL_GAP;
      }

      const courseNodeX = (skillStartX + skillX - COL_GAP) / 2 - NODE_W / 2;
      nodes.push({ id: courseNodeId, label: course.name, sublabel: course.subject, layer: 'course', x: courseNodeX, y: PADDING + NODE_H + ROW_GAP, isPrivate: false, scope: 'global', parentId: insNodeId, childIds: courseChildIds });
      edges.push({ from: insNodeId, to: courseNodeId });

      // 수강생 — layer 5 (과목 기준 x에서 시작)
      const students = course.students ?? [];
      let studentX = skillStartX;
      for (const st of students) {
        const studentNodeId = `student-${st.id}-${course.id}`;
        nodes.push({
          id: studentNodeId,
          label: st.displayName ?? '(이름 없음)',
          sublabel: st.email ?? '',
          layer: 'student',
          x: studentX,
          y: PADDING + (NODE_H + ROW_GAP) * 4,
          isPrivate: false,
          scope: 'global',
          parentId: courseNodeId,
          childIds: [],
        });
        edges.push({ from: courseNodeId, to: studentNodeId });
        studentX += NODE_W + COL_GAP;
      }
      // 수강생이 skill보다 많으면 courseX를 더 늘림
      if (studentX > skillX) courseX = studentX + COL_GAP;
      else courseX = skillX + COL_GAP * 2;
    }

    const insNodeX = (courseStartX + courseX - COL_GAP * 2) / 2 - NODE_W / 2;
    nodes.push({ id: insNodeId, label: ins.name, sublabel: '강사', layer: 'instructor', x: insNodeX, y: PADDING, isPrivate: false, scope: 'global', childIds: insChildIds });
    globalX = courseX + COL_GAP * 2;
  }

  return { nodes, edges };
}

// ── 노드 카드 ────────────────────────────────────────────────────────────────
function OrgNodeCard({ node, zoom, dashed = false }: { node: LayoutNode; zoom: number; dashed?: boolean }) {
  const c = COLORS[node.layer];
  const dotColor = node.status ? (AGENT_STATUS_COLOR[node.status] ?? '#a3a3a3') : c.border;
  return (
    <div
      data-org-card
      className="absolute rounded-xl shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer select-none"
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, backgroundColor: c.bg, border: `1.5px ${dashed ? 'dashed' : 'solid'} ${c.border}`, opacity: dashed ? 0.72 : 1 }}
    >
      <div className="flex flex-col px-3 py-2 gap-0.5 h-full justify-center">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, backgroundColor: dotColor, boxShadow: node.status && zoom > 0.5 ? `0 0 4px ${dotColor}` : 'none' }} />
          <span className="font-semibold text-xs truncate flex-1" style={{ color: c.text }}>{node.label}</span>
          {node.isPrivate && <Lock size={9} style={{ color: c.text, opacity: 0.6, flexShrink: 0 }} />}
          {!node.isPrivate && <Globe size={9} style={{ color: c.text, opacity: 0.3, flexShrink: 0 }} />}
        </div>
        <span className="text-[10px] truncate pl-4" style={{ color: c.text, opacity: 0.65 }}>{node.sublabel}</span>
        {node.layer === 'agent' && node.model && (
          <span className="text-[9px] truncate pl-4 font-mono" style={{ color: c.text, opacity: 0.45 }}>{node.model}</span>
        )}
      </div>
    </div>
  );
}

// ── 범례 ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500 dark:text-gray-400">
      {(['instructor','course','skill','agent','student'] as LayerType[]).map(l => (
        <div key={l} className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm border" style={{ backgroundColor: COLORS[l].bg, borderColor: COLORS[l].border }} />
          {{ instructor: '강사', course: '과목', skill: 'Skills', agent: '에이전트', student: '수강생' }[l]}
        </div>
      ))}
      <span className="ml-1 pl-2 border-l flex items-center gap-1"><Lock size={9} /> 비공개</span>
      <span className="flex items-center gap-1"><Globe size={9} /> 공개</span>
    </div>
  );
}

// ── 미연결 패널 ──────────────────────────────────────────────────────────────
function UnassignedPanel({ unassigned }: { unassigned: OrgFull['unassigned'] }) {
  const total = unassigned.skills.length + unassigned.agents.length;
  if (total === 0) return null;
  return (
    <div className="shrink-0 bg-gray-50 dark:bg-slate-900/60 border border-dashed border-gray-300 dark:border-slate-600 rounded-xl p-3 max-h-44 overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle size={13} className="text-amber-400" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">미연결 자산 ({total}개)</span>
        <span className="text-[10px] text-gray-400">— 과목/에이전트에 연결되지 않은 항목</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {unassigned.skills.map(skill => (
          <div key={skill.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ backgroundColor: COLORS.skill.bg, border: `1.5px dashed ${COLORS.skill.border}`, color: COLORS.skill.text }}>
            {skill.isPrivate ? <Lock size={9} /> : <Globe size={9} />}
            <span className="truncate max-w-[120px]">{skill.title}</span>
            <span className="opacity-50 text-[9px]">skill</span>
          </div>
        ))}
        {unassigned.agents.map(agent => (
          <div key={agent.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium" style={{ backgroundColor: COLORS.agent.bg, border: `1.5px dashed ${COLORS.agent.border}`, color: COLORS.agent.text }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: AGENT_STATUS_COLOR[agent.status] ?? '#a3a3a3' }} />
            <span className="truncate max-w-[120px]">{agent.name}</span>
            <span className="opacity-50 text-[9px]">{ROLE_LABELS[agent.role] ?? agent.role}</span>
            {agent.model && <span className="opacity-40 text-[9px] font-mono">{agent.model}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 메인 ────────────────────────────────────────────────────────────────────
export default function OrgChartPage() {
  const { user, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: instructorsData } = useQuery({
    queryKey: ['orgInstructors'],
    queryFn: async () => {
      const r = await fetch(`${API}/admin/org/instructors`, { headers });
      if (!r.ok) throw new Error('failed');
      return r.json() as Promise<{ instructors: Instructor[] }>;
    },
    enabled: isAdmin,
  });
  const instructors = instructorsData?.instructors ?? [];

  const [selectedInstructorId, setSelectedInstructorId] = useState<string>('all');
  const [instructorDropdownOpen, setInstructorDropdownOpen] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(true);

  const { data: orgFull, isLoading } = useQuery({
    queryKey: ['orgFull', selectedInstructorId],
    queryFn: async () => {
      const url = isAdmin && selectedInstructorId !== 'all'
        ? `${API}/admin/org/full?instructorId=${selectedInstructorId}`
        : `${API}/admin/org/full`;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error('failed');
      return r.json() as Promise<OrgFull>;
    },
  });

  const tree = orgFull?.tree ?? [];
  const unassigned = orgFull?.unassigned ?? { skills: [], agents: [] };
  const hasContent = tree.length > 0 || unassigned.skills.length > 0 || unassigned.agents.length > 0;

  const { nodes, edges, bounds } = useMemo(() => {
    if (tree.length === 0) return { nodes: [], edges: [], bounds: { width: 800, height: 400 } };
    const { nodes, edges } = buildLayout(tree);
    let maxX = 0, maxY = 0;
    for (const n of nodes) { maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + NODE_H); }
    return { nodes, edges, bounds: { width: maxX + PADDING, height: maxY + PADDING } };
  }, [tree]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || nodes.length === 0 || !containerRef.current) return;
    initialized.current = true;
    const c = containerRef.current;
    const fitZoom = Math.min((c.clientWidth - 40) / bounds.width, (c.clientHeight - 40) / bounds.height, 1);
    const chartW = bounds.width * fitZoom, chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (c.clientWidth - chartW) / 2, y: (c.clientHeight - chartH) / 2 });
  }, [nodes, bounds]);

  useEffect(() => { initialized.current = false; }, [selectedInstructorId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-org-card]')) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) });
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const newZoom = Math.min(Math.max(zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.12), 2.5);
    const scale = newZoom / zoom;
    setPan({ x: mx - scale * (mx - pan.x), y: my - scale * (my - pan.y) });
    setZoom(newZoom);
  }, [zoom, pan]);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const c = containerRef.current;
    const fitZoom = Math.min((c.clientWidth - 40) / bounds.width, (c.clientHeight - 40) / bounds.height, 1);
    const chartW = bounds.width * fitZoom, chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (c.clientWidth - chartW) / 2, y: (c.clientHeight - chartH) / 2 });
    initialized.current = true;
  }, [nodes, bounds]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const selectedLabel = !isAdmin ? '내 조직도' : selectedInstructorId === 'all' ? '전체 조직도' : (instructors.find(i => i.id === selectedInstructorId)?.name ?? '') + '의 조직도';
  const rowLabels: { layer: LayerType; label: string; y: number }[] = [
    { layer: 'instructor', label: '강사',      y: PADDING },
    { layer: 'course',     label: '과목',      y: PADDING + NODE_H + ROW_GAP },
    { layer: 'skill',      label: 'Skills',   y: PADDING + (NODE_H + ROW_GAP) * 2 },
    { layer: 'agent',      label: '에이전트', y: PADDING + (NODE_H + ROW_GAP) * 3 },
    { layer: 'student',    label: '수강생',   y: PADDING + (NODE_H + ROW_GAP) * 4 },
  ];

  return (
    <div className="flex flex-col h-full gap-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-3">
          <Network size={18} className="text-blue-600 dark:text-blue-400" />
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">에이전트 조직도</h2>

          {isAdmin && (
            <div className="relative">
              <button onClick={() => setInstructorDropdownOpen(o => !o)} className="flex items-center gap-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 hover:border-blue-300 transition-colors shadow-sm">
                <span className="font-medium text-gray-700 dark:text-gray-200">{selectedLabel}</span>
                <ChevronDown size={13} className="text-gray-400" />
              </button>
              {instructorDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl min-w-[200px] py-1 overflow-hidden">
                  <button onClick={() => { setSelectedInstructorId('all'); setInstructorDropdownOpen(false); }} className={`w-full text-left px-4 py-2 text-sm transition-colors ${selectedInstructorId === 'all' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 font-semibold' : 'hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200'}`}>전체 조직도</button>
                  {instructors.map(ins => (
                    <button key={ins.id} onClick={() => { setSelectedInstructorId(ins.id); setInstructorDropdownOpen(false); }} className={`w-full text-left px-4 py-2 text-sm transition-colors ${selectedInstructorId === ins.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 font-semibold' : 'hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200'}`}>{ins.name}</button>
                  ))}
                  {instructors.length === 0 && <p className="px-4 py-2 text-xs text-gray-400">강사 없음</p>}
                </div>
              )}
            </div>
          )}

          <button onClick={() => qc.invalidateQueries({ queryKey: ['orgFull'] })} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 transition-colors" title="새로고침">
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowUnassigned(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${showUnassigned ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-600 dark:text-amber-400' : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-500'}`}
          >
            {showUnassigned ? <Eye size={12} /> : <EyeOff size={12} />}
            미연결 자산 {showUnassigned ? '표시' : '숨김'}
            {(unassigned.skills.length + unassigned.agents.length) > 0 && (
              <span className="ml-1 bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-bold">
                {unassigned.skills.length + unassigned.agents.length}
              </span>
            )}
          </button>
          <Legend />
        </div>
      </div>

      {/* 캔버스 */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden relative bg-gray-50/50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-2xl"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* 배경 도트 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
          <defs><pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="currentColor" className="text-gray-400 dark:text-slate-500" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>

        {/* 계층 행 레이블 (배경) */}
        {nodes.length > 0 && (
          <div className="absolute pointer-events-none" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
            {rowLabels.map(rl => (
              <div key={rl.layer} className="absolute text-[10px] font-bold tracking-widest uppercase opacity-20"
                style={{ left: 0, top: rl.y + NODE_H / 2 - 7, color: COLORS[rl.layer].border }}>
                {rl.label}
              </div>
            ))}
          </div>
        )}

        {/* 줌 컨트롤 */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
          {[
            { label: '+', fn: () => { const nz = Math.min(zoom * 1.2, 2.5); if (containerRef.current) { const c = containerRef.current; const cx = c.clientWidth/2, cy = c.clientHeight/2; setPan({ x: cx-(nz/zoom)*(cx-pan.x), y: cy-(nz/zoom)*(cy-pan.y) }); } setZoom(nz); } },
            { label: '−', fn: () => { const nz = Math.max(zoom * 0.8, 0.12); if (containerRef.current) { const c = containerRef.current; const cx = c.clientWidth/2, cy = c.clientHeight/2; setPan({ x: cx-(nz/zoom)*(cx-pan.x), y: cy-(nz/zoom)*(cy-pan.y) }); } setZoom(nz); } },
            { label: 'Fit', fn: fitToScreen },
          ].map(btn => (
            <button key={btn.label} onClick={btn.fn} className="w-7 h-7 flex items-center justify-center bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-blue-300 shadow-sm transition-colors">
              {btn.label}
            </button>
          ))}
        </div>

        {/* 빈 상태 */}
        {!isLoading && !hasContent && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-slate-500">
            <Network size={40} strokeWidth={1} />
            <p className="text-sm font-medium">조직도가 없습니다.</p>
            <p className="text-xs text-center px-8">강사가 과목을 생성하고 Skills 및 에이전트를 연결하면<br/>여기에 5계층 조직도가 표시됩니다.</p>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* SVG 엣지 */}
        <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {edges.map(e => {
              const from = nodeMap.get(e.from), to = nodeMap.get(e.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
              const x2 = to.x + NODE_W / 2,   y2 = to.y;
              const midY = (y1 + y2) / 2;
              return (
                <path key={`${e.from}-${e.to}`}
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none" stroke={edgeColor(to)} strokeWidth={1.5} strokeOpacity={to.layer === 'student' ? 0.3 : 0.45}
                  strokeDasharray={to.layer === 'student' ? '5 3' : undefined}
                />
              );
            })}
          </g>
        </svg>

        {/* HTML 카드 레이어 */}
        <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          {nodes.map(node => <OrgNodeCard key={node.id} node={node} zoom={zoom} />)}
        </div>
      </div>

      {/* 미연결 자산 패널 */}
      {showUnassigned && <UnassignedPanel unassigned={unassigned} />}
    </div>
  );
}
