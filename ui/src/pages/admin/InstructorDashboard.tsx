/**
 * 강사 대시보드 — 담당 과목(Course Hub) + 수강생 현황 + EWS
 *
 * 탭 순서: [담당 과목(첫 번째)] → [수강생 현황] → [위험 수강생]
 */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { StudentRow } from '../../components/dashboard/StudentRow';
import { EwsRiskCard } from '../../components/dashboard/EwsRiskCard';
import type { StudentPage } from '../../components/dashboard/StudentRow';
import type { EwsStudent } from '../../components/dashboard/EwsRiskCard';
import AssignmentBoardModal from '../../components/AssignmentBoardModal';
import MDEditor from '@uiw/react-md-editor';
import { QRCodeSVG } from 'qrcode.react';
import {
  BookOpen, Brain, GraduationCap, ClipboardList, Plus,
  ChevronRight, RefreshCw, AlertCircle, CheckCircle, X, Search,
  Pencil, Trash2, Check, CalendarCheck, QrCode, Play, Square,
  Users,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL ?? '/api';
const PAGE_SIZE = 20;

type DashboardTab = 'courses' | 'students' | 'ews';
type ModalType = 'skills' | 'documents' | 'students' | 'assignments' | null;

interface Course {
  id: string; name: string; subject: string; isActive: boolean;
}
interface CourseStats {
  skills: number; documents: number; students: number; assignments: number;
}
interface SkillItem { id: string; title: string; tags: string[] | null; createdAt: string; courseId?: string | null }
interface DocItem { id: string; filename: string; category: string | null; courseId?: string | null }
interface StudentItem { id: string; email: string | null; displayName: string | null; courseId?: string | null; enrolledCourses?: { courseId: string; courseName: string; subject: string }[] }
interface AssignmentItem {
  id: string;
  title: string;
  content: string;
  dueAt: string | null;
  isPublished: boolean;
  createdAt: string;
  instructorName: string | null;
}

type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'O', absent: 'X', late: 'L', excused: 'A' };
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present:  'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  absent:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  late:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  excused:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};
const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

interface AttendanceSession {
  id: string; weekNo: number; sessionNo: number; sessionDate: string; isOpen: boolean;
}
interface AttendanceMatrixData {
  students: { id: string; displayName: string | null; email: string | null }[];
  sessions: AttendanceSession[];
  records: Record<string, Record<string, { status: AttendanceStatus; method: string }>>;
}

// ── 선택+생성 팝업 모달 ───────────────────────────────────────────────────
function SelectAddModal({
  type, courseId, token, onClose, onRefresh,
}: {
  type: Exclude<ModalType, null>;
  courseId: string;
  token: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [boardAssignmentId, setBoardAssignmentId] = useState<string | null>(null);

  // ── 스킬 ──────────────────────────────────────────────────
  const [newSkillTitle, setNewSkillTitle] = useState('');
  const [newSkillMarkdown, setNewSkillMarkdown] = useState('');

  // ── 교재 ──────────────────────────────────────────────────
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docCategory, setDocCategory] = useState('');
  const [docUploading, setDocUploading] = useState(false);
  const [docResult, setDocResult] = useState<string | null>(null);

  // ── 수강생 ─────────────────────────────────────────────────
  const [newStudentName, setNewStudentName] = useState('');

  // ── 과제 ──────────────────────────────────────────────────
  const [assignTitle, setAssignTitle] = useState('');
  const [assignContent, setAssignContent] = useState('');
  const [assignDueAt, setAssignDueAt] = useState('');
  const [assignFile, setAssignFile] = useState<File | null>(null);
  const [assignUploading, setAssignUploading] = useState(false);
  const [assignPosting, setAssignPosting] = useState(false);
  const [assignResult, setAssignResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // 전체 기관 아이템 조회
  const allSkillsQ = useQuery<{ skills: SkillItem[] }>({
    queryKey: ['all-skills'],
    queryFn: () => fetch(`${API}/admin/skills`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: type === 'skills',
  });
  const allDocsQ = useQuery<DocItem[]>({
    queryKey: ['all-documents'],
    queryFn: () => fetch(`${API}/admin/documents`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: type === 'documents',
  });
  const allStudentsQ = useQuery<StudentItem[]>({
    queryKey: ['adminStudents'],
    queryFn: () => fetch(`${API}/admin/students`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: type === 'students',
  });
  const assignmentsQ = useQuery<{ assignments: AssignmentItem[] }>({
    queryKey: ['course-assignments', courseId],
    queryFn: () => fetch(`${API}/assignments/course/${courseId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: type === 'assignments',
  });

  // 연결 mutation
  const linkMutation = useMutation({
    mutationFn: async (payload: { path: string; body: Record<string, string> }) => {
      const res = await fetch(`${API}/admin/courses/${courseId}/${payload.path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload.body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '연결 실패');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-skills', courseId] });
      qc.invalidateQueries({ queryKey: ['course-docs', courseId] });
      qc.invalidateQueries({ queryKey: ['course-students', courseId] });
      qc.invalidateQueries({ queryKey: ['course-summary', courseId] });
      qc.invalidateQueries({ queryKey: ['all-skills'] });
      qc.invalidateQueries({ queryKey: ['all-documents'] });
      qc.invalidateQueries({ queryKey: ['adminStudents'] });
      onRefresh();
    },
  });

  // 스킬 생성 mutation
  const createSkillMutation = useMutation({
    mutationFn: async () => {
      if (!newSkillTitle.trim() || !newSkillMarkdown.trim()) throw new Error('제목과 내용을 입력하세요.');
      const res = await fetch(`${API}/admin/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: newSkillTitle.trim(), markdown: newSkillMarkdown.trim(), courseId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '스킬 생성 실패');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-skills', courseId] });
      qc.invalidateQueries({ queryKey: ['course-summary', courseId] });
      qc.invalidateQueries({ queryKey: ['all-skills'] });
      setNewSkillTitle(''); setNewSkillMarkdown(''); setShowCreate(false);
      onRefresh();
    },
  });

  // 수강생 생성+연결 mutation
  const createStudentMutation = useMutation({
    mutationFn: async () => {
      if (!newStudentName.trim()) throw new Error('이름을 입력하세요.');
      const res = await fetch(`${API}/admin/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: newStudentName.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? '수강생 생성 실패');
      const data = await res.json();
      // 과목에 연결
      await fetch(`${API}/admin/courses/${courseId}/students/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentId: data.id }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['course-students', courseId] });
      qc.invalidateQueries({ queryKey: ['course-summary', courseId] });
      qc.invalidateQueries({ queryKey: ['adminStudents'] });
      setNewStudentName(''); setShowCreate(false);
      onRefresh();
    },
  });

  // 교재 파일 업로드
  const handleDocUpload = async () => {
    if (!docFile) return;
    setDocUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', docFile);
      if (docCategory) formData.append('category', docCategory);
      formData.append('courseId', courseId);
      const res = await fetch(`${API}/admin/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setDocResult('교재가 업로드되었습니다.');
        setDocFile(null); setDocCategory(''); setShowCreate(false);
        qc.invalidateQueries({ queryKey: ['course-docs', courseId] });
        qc.invalidateQueries({ queryKey: ['course-summary', courseId] });
        qc.invalidateQueries({ queryKey: ['all-documents'] });
        onRefresh();
      } else {
        const err = await res.json().catch(() => ({}));
        setDocResult(err.error ?? '업로드 실패');
      }
    } finally { setDocUploading(false); setTimeout(() => setDocResult(null), 3000); }
  };

  // 과제 등록
  const handleAssignPost = async () => {
    if (!assignTitle.trim() || !assignContent.trim()) return;
    setAssignPosting(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;

      // 파일 첨부가 있으면 먼저 업로드
      if (assignFile) {
        setAssignUploading(true);
        const formData = new FormData();
        formData.append('file', assignFile);
        const uploadRes = await fetch(`${API}/assignments/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        setAssignUploading(false);
        if (uploadRes.ok) {
          const uploaded = await uploadRes.json() as { url: string; fileName: string };
          fileUrl = uploaded.url;
          fileName = uploaded.fileName;
        }
      }

      const res = await fetch(`${API}/assignments/course/${courseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: assignTitle,
          content: assignContent,
          dueAt: assignDueAt ? new Date(assignDueAt).toISOString() : undefined,
          fileUrl,
          fileName,
        }),
      });
      const data = await res.json() as { assignment?: { id: string }; error?: string };
      if (res.ok) {
        setAssignResult({ ok: true, msg: '과제가 등록되어 수강생에게 알림이 전송되었습니다.' });
        setAssignTitle(''); setAssignContent(''); setAssignDueAt(''); setAssignFile(null); setShowCreate(false);
        qc.invalidateQueries({ queryKey: ['course-assignments', courseId] });
        qc.invalidateQueries({ queryKey: ['course-summary', courseId] });
        onRefresh();
        setTimeout(() => setAssignResult(null), 3000);
      } else {
        setAssignResult({ ok: false, msg: data.error ?? '오류 발생' });
      }
    } finally { setAssignPosting(false); setAssignUploading(false); }
  };

  const modalMeta: Record<Exclude<ModalType, null>, { title: string; color: string; borderColor: string }> = {
    skills:      { title: '스킬 선택 / 추가', color: 'text-pink-600', borderColor: 'border-pink-300' },
    documents:   { title: '교재 선택 / 업로드', color: 'text-green-600', borderColor: 'border-green-300' },
    students:    { title: '수강생 선택 / 추가', color: 'text-blue-600', borderColor: 'border-blue-300' },
    assignments: { title: '과제 등록', color: 'text-amber-600', borderColor: 'border-amber-300' },
  };
  const meta = modalMeta[type];

  // ── 필터링된 아이템 목록 ──
  const filteredSkills = (allSkillsQ.data?.skills ?? []).filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase())
  );
  const filteredDocs = (allDocsQ.data ?? []).filter(d =>
    d.filename.toLowerCase().includes(search.toLowerCase())
  );
  const filteredStudents = (allStudentsQ.data ?? []).filter(s =>
    (s.displayName ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const assignments = assignmentsQ.data?.assignments ?? [];

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full mx-4 flex flex-col border-t-4 ${meta.borderColor} ${type === 'assignments' ? 'max-w-2xl max-h-[92vh]' : 'max-w-lg max-h-[80vh]'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className={`font-bold text-base ${meta.color}`}>{meta.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
            <X size={18} />
          </button>
        </div>

        {/* 검색 (과제 제외) */}
        {type !== 'assignments' && (
          <div className="px-5 pt-3 pb-2">
            <div className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-700">
              <Search size={14} className="text-gray-400" />
              <input
                autoFocus
                type="text"
                className="flex-1 bg-transparent text-sm outline-none text-gray-700 dark:text-gray-200 placeholder-gray-400"
                placeholder="검색..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* 기존 아이템 목록 */}
        <div className="flex-1 overflow-y-auto px-5 py-2 min-h-0">
          {/* ── 스킬 목록 ── */}
          {type === 'skills' && (
            <div className="space-y-1">
              {allSkillsQ.isLoading && <p className="text-xs text-gray-400 animate-pulse py-2">불러오는 중…</p>}
              {filteredSkills.map(skill => {
                const isLinked = skill.courseId === courseId;
                return (
                  <div key={skill.id} className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${isLinked ? 'bg-pink-50 dark:bg-pink-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{skill.title}</p>
                      {skill.tags && skill.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {skill.tags.slice(0, 3).map(t => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 rounded-full">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {isLinked ? (
                      <span className="ml-2 text-xs text-pink-500 font-medium shrink-0">연결됨</span>
                    ) : (
                      <button
                        onClick={() => linkMutation.mutate({ path: 'skills/link', body: { skillId: skill.id } })}
                        disabled={linkMutation.isPending}
                        className="ml-2 text-xs px-3 py-1 bg-pink-500 hover:bg-pink-600 text-white rounded-lg shrink-0 disabled:opacity-50 transition"
                      >
                        추가
                      </button>
                    )}
                  </div>
                );
              })}
              {!allSkillsQ.isLoading && filteredSkills.length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">검색 결과가 없습니다.</p>
              )}
            </div>
          )}

          {/* ── 교재 목록 ── */}
          {type === 'documents' && (
            <div className="space-y-1">
              {allDocsQ.isLoading && <p className="text-xs text-gray-400 animate-pulse py-2">불러오는 중…</p>}
              {filteredDocs.map(doc => {
                const isLinked = doc.courseId === courseId;
                return (
                  <div key={doc.id} className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${isLinked ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{doc.filename}</p>
                      {doc.category && <p className="text-xs text-gray-400">{doc.category}</p>}
                    </div>
                    {isLinked ? (
                      <span className="ml-2 text-xs text-green-600 font-medium shrink-0">연결됨</span>
                    ) : (
                      <button
                        onClick={() => linkMutation.mutate({ path: 'documents/link', body: { sourceFileName: doc.filename } })}
                        disabled={linkMutation.isPending}
                        className="ml-2 text-xs px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg shrink-0 disabled:opacity-50 transition"
                      >
                        추가
                      </button>
                    )}
                  </div>
                );
              })}
              {!allDocsQ.isLoading && filteredDocs.length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">등록된 교재가 없습니다.</p>
              )}
            </div>
          )}

          {/* ── 수강생 목록 ── */}
          {type === 'students' && (
            <div className="space-y-1">
              {allStudentsQ.isLoading && <p className="text-xs text-gray-400 animate-pulse py-2">불러오는 중…</p>}
              {filteredStudents.map(student => {
                const isLinked = student.enrolledCourses?.some(c => c.courseId === courseId) ?? false;
                const isOtherCourse = !isLinked && (student.enrolledCourses?.length ?? 0) > 0;
                return (
                  <div key={student.id} className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${isLinked ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                        {student.displayName ?? '(이름없음)'}
                      </p>
                      {isOtherCourse && <p className="text-xs text-amber-500">다른 과목에 배정됨</p>}
                      {student.email && <p className="text-xs text-gray-400 truncate">{student.email}</p>}
                    </div>
                    {isLinked ? (
                      <span className="ml-2 text-xs text-blue-500 font-medium shrink-0">배정됨</span>
                    ) : (
                      <button
                        onClick={() => linkMutation.mutate({ path: 'students/link', body: { studentId: student.id } })}
                        disabled={linkMutation.isPending}
                        className="ml-2 text-xs px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shrink-0 disabled:opacity-50 transition"
                      >
                        배정
                      </button>
                    )}
                  </div>
                );
              })}
              {!allStudentsQ.isLoading && filteredStudents.length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">등록된 수강생이 없습니다.</p>
              )}
            </div>
          )}

          {/* ── 과제 목록 ── */}
          {type === 'assignments' && (
            <div className="space-y-1">
              {assignmentsQ.isLoading && <p className="text-xs text-gray-400 animate-pulse py-2">불러오는 중…</p>}
              {assignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{a.title}</p>
                    {a.dueAt && <p className="text-xs text-gray-400">마감: {new Date(a.dueAt).toLocaleDateString('ko-KR')}</p>}
                  </div>
                  <button
                    onClick={() => setBoardAssignmentId(a.id)}
                    className="ml-2 text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg shrink-0 transition"
                  >
                    보기
                  </button>
                </div>
              ))}
              {!assignmentsQ.isLoading && assignments.length === 0 && (
                <p className="text-xs text-gray-400 py-4 text-center">등록된 과제가 없습니다.</p>
              )}
            </div>
          )}
        </div>

        {/* 결과 메시지 */}
        {(assignResult || docResult) && (
          <div className="px-5 pb-2">
            {assignResult && (
              <div className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg ${assignResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {assignResult.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {assignResult.msg}
              </div>
            )}
            {docResult && (
              <div className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-green-50 text-green-700">
                <CheckCircle size={12} /> {docResult}
              </div>
            )}
          </div>
        )}

        {/* 인라인 생성 폼 */}
        {showCreate && (
          <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
            {type === 'skills' && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">새 스킬 생성</p>
                <input
                  autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-300 bg-white dark:bg-gray-700 dark:text-white"
                  placeholder="스킬 제목"
                  value={newSkillTitle}
                  onChange={e => setNewSkillTitle(e.target.value)}
                />
                <textarea
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 h-24 resize-none focus:outline-none focus:ring-2 focus:ring-pink-300 bg-white dark:bg-gray-700 dark:text-white"
                  placeholder="스킬 내용 (Markdown)"
                  value={newSkillMarkdown}
                  onChange={e => setNewSkillMarkdown(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => createSkillMutation.mutate()}
                    disabled={!newSkillTitle.trim() || !newSkillMarkdown.trim() || createSkillMutation.isPending}
                    className="flex-1 text-xs font-medium bg-pink-500 hover:bg-pink-600 text-white py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {createSkillMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} 생성
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 text-xs border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">취소</button>
                </div>
                {createSkillMutation.isError && (
                  <p className="text-xs text-red-500">{(createSkillMutation.error as Error).message}</p>
                )}
              </div>
            )}

            {type === 'documents' && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">교재 업로드</p>
                <input
                  type="file"
                  className="w-full text-xs text-gray-600 file:mr-3 file:text-xs file:font-medium file:bg-green-50 file:text-green-700 file:border-0 file:rounded-lg file:px-3 file:py-1 file:cursor-pointer hover:file:bg-green-100"
                  onChange={e => setDocFile(e.target.files?.[0] ?? null)}
                />
                <input
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-300 bg-white dark:bg-gray-700 dark:text-white"
                  placeholder="카테고리 (선택)"
                  value={docCategory}
                  onChange={e => setDocCategory(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleDocUpload}
                    disabled={!docFile || docUploading}
                    className="flex-1 text-xs font-medium bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {docUploading ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} 업로드
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 text-xs border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">취소</button>
                </div>
              </div>
            )}

            {type === 'students' && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">새 수강생 추가</p>
                <input
                  autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white dark:bg-gray-700 dark:text-white"
                  placeholder="수강생 이름"
                  value={newStudentName}
                  onChange={e => setNewStudentName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createStudentMutation.mutate()}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => createStudentMutation.mutate()}
                    disabled={!newStudentName.trim() || createStudentMutation.isPending}
                    className="flex-1 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {createStudentMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />} 추가
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 text-xs border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">취소</button>
                </div>
                {createStudentMutation.isError && (
                  <p className="text-xs text-red-500">{(createStudentMutation.error as Error).message}</p>
                )}
              </div>
            )}

            {type === 'assignments' && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">새 과제 등록</p>
                <input
                  autoFocus
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-gray-700 dark:text-white"
                  placeholder="과제 제목 *"
                  value={assignTitle}
                  onChange={e => setAssignTitle(e.target.value)}
                />
                {/* 마크다운 에디터 — 단일 편집 뷰, 흰색 배경 */}
                <div data-color-mode="light" className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                  <MDEditor
                    value={assignContent}
                    onChange={v => setAssignContent(v ?? '')}
                    height={320}
                    preview="edit"
                    hideToolbar={false}
                    visibleDragbar={false}
                    style={{ fontSize: 13, backgroundColor: '#ffffff', color: '#111827' }}
                    textareaProps={{ placeholder: '과제 내용 * — 마크다운으로 작성 가능합니다.\n\n예) ## 과제 안내\n- 제출 방법: ...\n- 참고 자료: ...' }}
                  />
                </div>
                <input
                  type="datetime-local"
                  className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white dark:bg-gray-700 dark:text-white"
                  value={assignDueAt}
                  onChange={e => setAssignDueAt(e.target.value)}
                />
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">첨부파일 (선택)</label>
                  <input
                    type="file"
                    className="w-full text-xs text-gray-600 file:mr-3 file:text-xs file:font-medium file:bg-amber-50 file:text-amber-700 file:border-0 file:rounded-lg file:px-3 file:py-1 file:cursor-pointer hover:file:bg-amber-100"
                    onChange={e => setAssignFile(e.target.files?.[0] ?? null)}
                  />
                  {assignFile && (
                    <p className="text-[11px] text-gray-400 mt-1 truncate">선택됨: {assignFile.name}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAssignPost}
                    disabled={!assignTitle.trim() || !assignContent.trim() || assignPosting || assignUploading}
                    className="flex-1 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {(assignPosting || assignUploading) ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                    {assignUploading ? '파일 업로드 중...' : '등록'}
                  </button>
                  <button onClick={() => setShowCreate(false)} className="px-4 text-xs border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">취소</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 하단: + 버튼 (인라인 생성) */}
        {!showCreate && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setShowCreate(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition"
            >
              <Plus size={13} />
              {type === 'skills' && '새 스킬 생성'}
              {type === 'documents' && '새 교재 업로드'}
              {type === 'students' && '새 수강생 추가'}
              {type === 'assignments' && '새 과제 등록'}
            </button>
          </div>
        )}
      </div>
    </div>

    {boardAssignmentId && (
      <AssignmentBoardModal
        assignmentId={boardAssignmentId}
        onClose={() => setBoardAssignmentId(null)}
        onAnalyze={() => setBoardAssignmentId(null)}
        onDeleted={() => {
          setBoardAssignmentId(null);
          void qc.invalidateQueries({ queryKey: ['course-assignments', courseId] });
        }}
      />
    )}
    </>
  );
}

// ── 패널 카드 ─────────────────────────────────────────────────────────────
function CoursePanel({
  icon, title, count, colorClass, loading, items, onOpenModal,
}: {
  icon: React.ReactNode; title: string; count?: number; colorClass: string;
  loading: boolean; items: string[]; onOpenModal: () => void;
}) {
  return (
    <div className={`rounded-xl border p-4 ${colorClass}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">{icon}<span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</span></div>
        <span className="text-lg font-bold text-gray-900 dark:text-white">{loading ? '—' : (count ?? 0)}</span>
      </div>
      <ul className="space-y-1 mb-3 min-h-[48px] max-h-[160px] overflow-y-auto pr-0.5 scrollbar-thin">
        {items.length === 0 && !loading && <li className="text-xs text-gray-400">항목 없음</li>}
        {items.map((item, i) => (
          <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
            <ChevronRight size={11} className="text-gray-400 shrink-0" />
            <span className="truncate">{item}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={onOpenModal}
        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs font-medium bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-300 shadow-sm"
      >
        <Plus size={13} /> 선택 / 추가
      </button>
    </div>
  );
}

// ── 담당 과목 탭 내부 ─────────────────────────────────────────────────────
function CoursesTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  // 수정 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSubject, setEditSubject] = useState('');

  // ── 출결 관리 상태 ───────────────────────────────────────────────────────
  const [attWeek, setAttWeek] = useState(1);
  const [attSession, setAttSession] = useState(1);
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [openSession, setOpenSession] = useState<AttendanceSession | null>(null);
  const [qrData, setQrData] = useState<{ verifyUrl: string; expiresAt: string } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrRemaining, setQrRemaining] = useState(0);

  // QR 타이머
  useEffect(() => {
    if (!qrData) return;
    const tick = () => setQrRemaining(Math.max(0, Math.floor((new Date(qrData.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qrData]);

  const coursesQ = useQuery<{ courses: Course[] }>({
    queryKey: ['my-courses'],
    queryFn: () => fetch(`${API}/admin/courses`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
  });

  // ── 출결 매트릭스 쿼리 ────────────────────────────────────────────────────
  const attendanceQ = useQuery<AttendanceMatrixData>({
    queryKey: ['attendance-matrix', selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const res = await fetch(`${API}/attendance/courses/${selectedId}/matrix`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { students: [], sessions: [], records: {} };
      return res.json();
    },
  });

  // 열린 세션 감지
  useEffect(() => {
    const open = attendanceQ.data?.sessions.find(s => s.isOpen) ?? null;
    setOpenSession(open);
    if (!open) { setQrData(null); }
  }, [attendanceQ.data]);

  // ── 출결 뮤테이션 ────────────────────────────────────────────────────────
  const openSessionMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/attendance/courses/${selectedId}/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekNo: attWeek, sessionNo: attSession, sessionDate: attDate }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? '실패'); }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedId] });
      setSelectedStudentIds([]);
    },
  });

  const closeSessionMut = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`${API}/attendance/sessions/${sessionId}/close`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('세션 닫기 실패');
      return res.json();
    },
    onSuccess: () => {
      setQrData(null);
      void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedId] });
    },
  });

  const manualMut = useMutation({
    mutationFn: async ({ sessionId, studentId, status }: { sessionId: string; studentId: string; status: AttendanceStatus }) => {
      const res = await fetch(`${API}/attendance/sessions/${sessionId}/manual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ studentId, status }] }),
      });
      if (!res.ok) throw new Error('입력 실패');
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedId] }),
  });

  const sendAttendanceRequestMut = useMutation({
    mutationFn: async ({ sessionId, studentIds }: { sessionId: string; studentIds: string[] }) => {
      // 선택된 수강생들을 출석(present) 요청 전송 — 강사가 직접 O 처리
      await Promise.all(studentIds.map(sid =>
        fetch(`${API}/attendance/sessions/${sessionId}/manual`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ studentId: sid, status: 'present' as const }] }),
        })
      ));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedId] });
      setSelectedStudentIds([]);
    },
  });

  const genQrMut = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`${API}/attendance/sessions/${sessionId}/qr`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('QR 생성 실패');
      return res.json() as Promise<{ verifyUrl: string; expiresAt: string }>;
    },
    onSuccess: (data) => { setQrData(data); setShowQrModal(true); },
  });

  const summaryQ = useQuery<{ course: Course; stats: CourseStats }>({
    queryKey: ['course-summary', selectedId],
    queryFn: () => fetch(`${API}/admin/courses/${selectedId}/summary`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: !!selectedId,
  });

  const skillsQ = useQuery<{ skills: SkillItem[] }>({
    queryKey: ['course-skills', selectedId],
    queryFn: () => fetch(`${API}/admin/courses/${selectedId}/skills`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: !!selectedId,
  });
  const docsQ = useQuery<{ documents: DocItem[] }>({
    queryKey: ['course-docs', selectedId],
    queryFn: () => fetch(`${API}/admin/courses/${selectedId}/documents`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: !!selectedId,
  });
  const courseStudentsQ = useQuery<{ students: StudentItem[] }>({
    queryKey: ['course-students', selectedId],
    queryFn: () => fetch(`${API}/admin/courses/${selectedId}/students`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: !!selectedId,
  });
  const assignmentsQ = useQuery<{ assignments: AssignmentItem[] }>({
    queryKey: ['course-assignments', selectedId],
    queryFn: () => fetch(`${API}/assignments/course/${selectedId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    enabled: !!selectedId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/admin/courses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName, subject: newSubject }),
      });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || '과목 생성 실패');
        }
        return res.json();
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['my-courses'] });
        setNewName(''); setNewSubject(''); setShowAddForm(false);
      },
      onError: (err) => {
        alert(err.message);
      }
    });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, subject }: { id: string; name: string; subject: string }) => {
      const res = await fetch(`${API}/admin/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, subject }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '과목 수정 실패');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-courses'] });
      qc.invalidateQueries({ queryKey: ['course-summary', editingId] });
      setEditingId(null);
    },
    onError: (err: Error) => alert(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/admin/courses/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '과목 삭제 실패');
      }
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['my-courses'] });
      if (selectedId === id) setSelectedId(null);
    },
    onError: (err: Error) => alert(err.message),
  });

  const courses = coursesQ.data?.courses || [];
  const selectedCourse = courses.find(c => c.id === selectedId);

  const skills = skillsQ.data?.skills || [];
  const docs = docsQ.data?.documents || [];
  const courseStudents = courseStudentsQ.data?.students || [];
  const assignments = assignmentsQ.data?.assignments || [];
  const stats = summaryQ.data?.stats;

  return (
    <div className="flex gap-4 min-h-[300px]">
      {/* 좌측: 과목 목록 */}
      <aside className="w-52 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">내 과목</span>
          <button onClick={() => setShowAddForm(v => !v)} className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors" title="과목 추가">
            <Plus size={14} />
          </button>
        </div>

        {showAddForm && (
          <div className="bg-white border border-blue-100 rounded-xl p-3 space-y-2 shadow-sm">
            <input className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="과목명 (예: 자바 전문가반)" value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="w-full text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="분야 (예: java)" value={newSubject} onChange={e => setNewSubject(e.target.value)} />
            <button onClick={() => createMutation.mutate()} disabled={!newName || !newSubject || createMutation.isPending} className="w-full text-xs font-medium bg-blue-600 text-white py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {createMutation.isPending ? '생성 중...' : '과목 생성'}
            </button>
          </div>
        )}

        <div className="space-y-1 flex-1 overflow-y-auto">
          {coursesQ.isLoading && <p className="text-xs text-gray-400 px-2 animate-pulse">불러오는 중…</p>}
          {courses.map(c => (
            <div key={c.id} className="group relative">
              {editingId === c.id ? (
                /* ── 인라인 수정 폼 ── */
                <div className="bg-white border border-blue-200 rounded-xl p-2.5 space-y-1.5 shadow-sm">
                  <input
                    className="w-full text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="과목명"
                    autoFocus
                  />
                  <input
                    className="w-full text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    value={editSubject}
                    onChange={e => setEditSubject(e.target.value)}
                    placeholder="분야"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateMutation.mutate({ id: c.id, name: editName, subject: editSubject })}
                      disabled={!editName || !editSubject || updateMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1 text-xs bg-blue-600 text-white py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Check size={11} /> {updateMutation.isPending ? '저장 중…' : '저장'}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 text-xs text-gray-500 hover:bg-gray-100 rounded-lg"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                /* ── 일반 과목 버튼 ── */
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${selectedId === c.id ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'hover:bg-gray-50 text-gray-700 border border-transparent'}`}
                >
                  <p className="text-sm font-medium leading-tight truncate pr-10">{c.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{c.subject}</p>
                </button>
              )}

              {/* 수정/삭제 버튼 — hover 시 표시 */}
              {editingId !== c.id && (
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(c.id);
                      setEditName(c.name);
                      setEditSubject(c.subject);
                    }}
                    className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                    title="과목 수정"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`"${c.name}" 과목을 삭제하시겠습니까?\n과목에 연결된 수강생·스킬·문서는 연결이 해제됩니다.`)) {
                        deleteMutation.mutate(c.id);
                      }
                    }}
                    className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500"
                    title="과목 삭제"
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {!coursesQ.isLoading && courses.length === 0 && <p className="text-xs text-gray-400 px-2">과목이 없습니다. + 버튼으로 추가해주세요.</p>}
        </div>
      </aside>

      {/* 우측: 과목 상세 현황 */}
      <div className="flex-1 min-w-0">
        {!selectedId ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <BookOpen size={32} className="opacity-30" />
            <p className="text-sm">좌측에서 과목을 선택하세요</p>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedCourse && (
              <div className="flex items-center gap-3 px-1">
                <div className="flex-1">
                  <h2 className="text-base font-bold text-gray-900">{selectedCourse.name}</h2>
                  <p className="text-xs text-gray-500">{selectedCourse.subject}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedCourse.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {selectedCourse.isActive ? '활성' : '종료'}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <CoursePanel icon={<Brain size={16} className="text-pink-500" />} title="스킬 현황" count={stats?.skills} colorClass="bg-pink-50 dark:bg-pink-900/20 border-pink-100 dark:border-pink-800" loading={summaryQ.isLoading} items={skills.map(s => s.title)} onOpenModal={() => setActiveModal('skills')} />
              <CoursePanel icon={<BookOpen size={16} className="text-green-500" />} title="교재 현황" count={stats?.documents} colorClass="bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800" loading={summaryQ.isLoading} items={docs.map(d => d.filename)} onOpenModal={() => setActiveModal('documents')} />
              <CoursePanel icon={<GraduationCap size={16} className="text-blue-500" />} title="수강생 현황" count={stats?.students} colorClass="bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800" loading={summaryQ.isLoading} items={courseStudents.map(s => s.displayName ?? s.email ?? '(미입력)')} onOpenModal={() => setActiveModal('students')} />
              <CoursePanel icon={<ClipboardList size={16} className="text-amber-500" />} title="과제 현황" count={stats?.assignments} colorClass="bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800" loading={summaryQ.isLoading} items={assignments.map(a => a.title)} onOpenModal={() => setActiveModal('assignments')} />
            </div>

            {/* ── 출결 관리 ──────────────────────────────────────────────── */}
            <div className="rounded-xl border border-indigo-100 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/20 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <CalendarCheck size={16} className="text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">출결 관리</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1"></span>
                {openSession && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    {openSession.weekNo}주차 {openSession.sessionNo}회차 진행 중
                  </span>
                )}
              </div>

              {/* 주차/회차/날짜 선택 + 세션 열기 */}
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">주차</label>
                  <input type="number" min={1} max={52} value={attWeek}
                    onChange={e => setAttWeek(Number(e.target.value))}
                    className="w-16 text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">회차</label>
                  <input type="number" min={1} max={20} value={attSession}
                    onChange={e => setAttSession(Number(e.target.value))}
                    className="w-16 text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">날짜</label>
                  <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)}
                    className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <button
                  onClick={() => openSessionMut.mutate()}
                  disabled={openSessionMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg font-medium disabled:opacity-50"
                >
                  <Play size={12} />
                  {openSession ? '회차 변경' : '세션 열기'}
                </button>
                {openSession && (
                  <>
                    <button
                      onClick={() => genQrMut.mutate(openSession.id)}
                      disabled={genQrMut.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg font-medium disabled:opacity-50"
                    >
                      <QrCode size={12} /> QR
                    </button>
                    <button
                      onClick={() => closeSessionMut.mutate(openSession.id)}
                      disabled={closeSessionMut.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg font-medium disabled:opacity-50"
                    >
                      <Square size={12} /> 닫기
                    </button>
                  </>
                )}
              </div>

              {/* 수강생 선택 + 출석 요청 전송 */}
              {openSession && (attendanceQ.data?.students.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                      <Users size={12} /> 수강생 선택 후 출석 요청
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setSelectedStudentIds(attendanceQ.data!.students.map(s => s.id))}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      >전체 선택</button>
                      <button
                        onClick={() => setSelectedStudentIds([])}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                      >해제</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto pr-0.5">
                    {attendanceQ.data!.students.map(s => {
                      const key = `${openSession.weekNo}_${openSession.sessionNo}`;
                      const rec = attendanceQ.data!.records[s.id]?.[key];
                      const isSelected = selectedStudentIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-500'
                              : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={e => setSelectedStudentIds(prev =>
                              e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id)
                            )}
                            className="h-3.5 w-3.5"
                          />
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
                            {s.displayName ?? s.email ?? s.id.slice(0, 8)}
                          </span>
                          {rec?.status && (
                            <span className={`text-[10px] font-bold w-4 h-4 rounded-full inline-flex items-center justify-center ${STATUS_COLOR[rec.status]}`}>
                              {STATUS_LABEL[rec.status]}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => sendAttendanceRequestMut.mutate({ sessionId: openSession.id, studentIds: selectedStudentIds })}
                    disabled={selectedStudentIds.length === 0 || sendAttendanceRequestMut.isPending}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg font-medium disabled:opacity-50 transition-colors"
                  >
                    <CalendarCheck size={13} />
                    {sendAttendanceRequestMut.isPending
                      ? '처리 중...'
                      : `선택한 ${selectedStudentIds.length}명 출석 처리`}
                  </button>
                  {sendAttendanceRequestMut.isError && (
                    <p className="text-xs text-red-500">{(sendAttendanceRequestMut.error as Error).message}</p>
                  )}
                </div>
              )}

              {/* 출결 그리드 (현황 테이블) */}
              {(attendanceQ.data?.sessions.length ?? 0) > 0 && (
                <div className="overflow-auto max-h-64 mt-1">
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-indigo-50 dark:bg-indigo-950/40 z-10">
                      <tr>
                        <th className="sticky left-0 z-20 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-indigo-100 dark:border-indigo-800 min-w-[100px]">수강생</th>
                        {attendanceQ.data!.sessions.map(s => (
                          <th key={s.id} className={`px-1.5 py-1.5 text-center font-semibold border-b border-indigo-100 dark:border-indigo-800 min-w-[48px] ${s.isOpen ? 'text-green-700 dark:text-green-300' : 'text-gray-500 dark:text-gray-400'}`}>
                            <div>{s.weekNo}주</div>
                            <div className="font-normal text-gray-400">{s.sessionNo}회</div>
                            {s.isOpen && <div className="text-[9px] text-green-500">●</div>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(attendanceQ.data?.students ?? []).map((student, ri) => (
                        <tr key={student.id} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-indigo-50/40 dark:bg-indigo-950/10'}>
                          <td className="sticky left-0 bg-inherit px-2 py-1.5 font-medium text-gray-700 dark:text-gray-300 border-b border-indigo-50 dark:border-indigo-900/30 truncate max-w-[110px]">
                            {student.displayName ?? student.email ?? student.id.slice(0, 8)}
                          </td>
                          {attendanceQ.data!.sessions.map(sess => {
                            const key = `${sess.weekNo}_${sess.sessionNo}`;
                            const rec = attendanceQ.data!.records[student.id]?.[key];
                            const nextS = rec?.status
                              ? STATUS_CYCLE[(STATUS_CYCLE.indexOf(rec.status) + 1) % 4]!
                              : 'present' as AttendanceStatus;
                            return (
                              <td key={sess.id}
                                className={`px-1 py-1 text-center border-b border-indigo-50 dark:border-indigo-900/30 ${sess.isOpen ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/30' : ''}`}
                                onClick={() => sess.isOpen && manualMut.mutate({ sessionId: sess.id, studentId: student.id, status: nextS })}
                                title={sess.isOpen ? '클릭하여 변경' : rec?.method ?? ''}
                              >
                                {rec?.status ? (
                                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold ${STATUS_COLOR[rec.status]}`}>
                                    {STATUS_LABEL[rec.status]}
                                  </span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">–</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(attendanceQ.data?.students.length ?? 0) === 0 && selectedId && (
                <p className="text-xs text-gray-400 text-center py-2">수강생이 없습니다.</p>
              )}
            </div>

            {/* 선택/추가 모달 */}
            {activeModal && selectedId && (
              <SelectAddModal
                type={activeModal}
                courseId={selectedId}
                token={token}
                onClose={() => setActiveModal(null)}
                onRefresh={() => {
                  qc.invalidateQueries({ queryKey: ['course-skills', selectedId] });
                  qc.invalidateQueries({ queryKey: ['course-docs', selectedId] });
                  qc.invalidateQueries({ queryKey: ['course-students', selectedId] });
                  qc.invalidateQueries({ queryKey: ['course-assignments', selectedId] });
                  qc.invalidateQueries({ queryKey: ['course-summary', selectedId] });
                }}
              />
            )}

            {/* QR 모달 */}
            {showQrModal && qrData && openSession && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowQrModal(false)}>
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-72 flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between w-full">
                    <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                      <QrCode size={15} className="text-indigo-500" />
                      QR 출석 코드
                    </h3>
                    <button onClick={() => setShowQrModal(false)} className="text-gray-400 hover:text-gray-600">
                      <X size={16} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">{openSession.weekNo}주차 {openSession.sessionNo}회차</p>
                  <div className="p-3 bg-white rounded-xl border border-gray-200">
                    <QRCodeSVG value={qrData.verifyUrl} size={180} />
                  </div>
                  <div className="w-full">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>유효 시간</span>
                      <span className="font-mono">{Math.floor(qrRemaining / 60)}:{String(qrRemaining % 60).padStart(2, '0')}</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-1000 ${qrRemaining > 60 ? 'bg-green-500' : qrRemaining > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${(qrRemaining / 300) * 100}%` }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => genQrMut.mutate(openSession.id)}
                    disabled={genQrMut.isPending}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg font-medium"
                  >
                    <RefreshCw size={12} /> QR 재생성
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export default function InstructorDashboard({
  onNavigateTo,
  onOpenInstructorChat,
}: {
  onNavigateTo?: (tab: string) => void;
  onOpenInstructorChat?: (notificationId: string) => void;
}) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<DashboardTab>('courses');
  const [page, setPage] = useState(0);

  void onNavigateTo; // 외부 탐색이 필요한 경우를 위해 prop은 유지

  const studentsQuery = useQuery<StudentPage>({
    queryKey: ['instructor-students', page],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const res = await fetch(`${API}/instructor/students?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('수강생 목록 조회 실패');
      return res.json() as Promise<StudentPage>;
    },
    enabled: activeTab === 'students',
    staleTime: 60_000,
  });

  const ewsQuery = useQuery<EwsStudent[]>({
    queryKey: ['instructor-ews'],
    queryFn: async () => {
      const res = await fetch(`${API}/instructor/ews`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('EWS 조회 실패');
      return res.json() as Promise<EwsStudent[]>;
    },
    enabled: activeTab === 'ews',
    staleTime: 60_000,
  });

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ['instructor-ews'] });
    queryClient.invalidateQueries({ queryKey: ['instructor-students'] });
    queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };

  const totalPages = studentsQuery.data ? Math.ceil(studentsQuery.data.total / PAGE_SIZE) : 0;

  const TABS: { id: DashboardTab; label: string }[] = [
    { id: 'courses',  label: '담당 과목' },
    { id: 'students', label: '수강생 현황' },
    { id: 'ews',      label: '위험 수강생' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex border-b border-gray-200">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setPage(0); }} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
            {tab.id === 'ews' && ewsQuery.data && ewsQuery.data.length > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{ewsQuery.data.length}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'courses' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5">
          <CoursesTab token={token ?? ''} />
        </div>
      )}

      {activeTab === 'students' && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          {studentsQuery.isLoading && <div className="text-center py-12 text-gray-400 text-sm animate-pulse">로딩 중…</div>}
          {studentsQuery.isError && <div className="text-center text-red-500 text-sm py-8">데이터를 불러오지 못했습니다.</div>}
          {studentsQuery.data && (
            <>
              <p className="text-xs text-gray-500 mb-3">총 {studentsQuery.data.total}명 · 페이지 {page + 1} / {totalPages || 1}</p>
              {studentsQuery.data.items.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">등록된 수강생이 없습니다.</p>
              ) : (
                studentsQuery.data.items.map((s) => (
                  <StudentRow
                    key={s.id}
                    student={s}
                    onOpenChat={(notificationId) => {
                      if (onOpenInstructorChat) {
                        onOpenInstructorChat(notificationId);
                      }
                    }}
                  />
                ))
              )}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">← 이전</button>
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      const pn = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
                      return <button key={pn} onClick={() => setPage(pn)} className={`w-7 h-7 text-xs rounded-lg transition-colors ${pn === page ? 'bg-blue-500 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>{pn + 1}</button>;
                    })}
                  </div>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">다음 →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'ews' && (
        <div className="space-y-3">
          {ewsQuery.isLoading && <div className="text-center py-12 text-gray-400 text-sm animate-pulse">로딩 중…</div>}
          {ewsQuery.isError && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm text-center">데이터를 불러오지 못했습니다.</div>}
          {ewsQuery.data && ewsQuery.data.length === 0 && <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center text-green-700 text-sm">현재 위험 수강생이 없습니다.</div>}
          {ewsQuery.data?.map(s => <EwsRiskCard key={s.scoreId} student={s} token={token ?? ''} onActionDone={handleActionDone} />)}
        </div>
      )}
    </div>
  );
}
