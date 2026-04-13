import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GraduationCap, UserPlus, Loader2, CheckCircle2, XCircle,
  ToggleLeft, ToggleRight, Trash2, FileEdit, X, ShieldCheck, BookOpen,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiFetch';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// permissions 비트마스크 (auth.ts의 PERMISSIONS와 동일)
const PERMISSIONS = {
  VIEW_DASHBOARD:      1 << 0,
  MANAGE_STUDENTS:     1 << 1,
  MANAGE_INSTRUCTORS:  1 << 2,
  MANAGE_AGENTS:       1 << 3,
  MANAGE_SKILLS:       1 << 4,
  MANAGE_DOCUMENTS:    1 << 5,
  VIEW_COSTS:          1 << 6,
  MANAGE_SECRETS:      1 << 7,
  MANAGE_INSTITUTIONS: 1 << 8,
} as const;

const PERMISSION_LABELS: Record<keyof typeof PERMISSIONS, string> = {
  VIEW_DASHBOARD:      '대시보드 조회',
  MANAGE_STUDENTS:     '수강생 관리',
  MANAGE_INSTRUCTORS:  '강사 관리',
  MANAGE_AGENTS:       '에이전트 관리',
  MANAGE_SKILLS:       '스킬 관리',
  MANAGE_DOCUMENTS:    '교재 관리',
  VIEW_COSTS:          '비용 조회',
  MANAGE_SECRETS:      '시스템 키 관리',
  MANAGE_INSTITUTIONS: '기관 관리',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce((acc, val) => acc | val, 0);

interface Instructor {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: number;
  isActive: boolean;
  tags: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
  students?: { id: string; displayName: string }[];
  assignedCourses?: { courseId: string; courseName: string; subject: string }[];
}

interface NewInstructorForm {
  name: string;
  email: string;
  password: string;
  tags: string;
}

const emptyForm: NewInstructorForm = { name: '', email: '', password: '', tags: '' };

export default function InstructorManagement() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<NewInstructorForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [coursesPopupInstructor, setCoursesPopupInstructor] = useState<Instructor | null>(null);

  // 수정 모달 상태
  const [editingInstructor, setEditingInstructor] = useState<Instructor | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editPermissions, setEditPermissions] = useState(0);
  const [editStudentIds, setEditStudentIds] = useState<string[]>([]);

  const queryClient = useQueryClient();

  // ── 목록 조회 ──────────────────────────────────────────────────────────────
  const { data: allStudents } = useQuery<{ id: string; displayName: string; instructorId: string | null }[]>({
    queryKey: ["adminStudents"],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/students`);
      return res.json();
    },
  });

  const { data: instructors, isLoading, isError } = useQuery<Instructor[]>({
    queryKey: ['adminInstructors'],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/instructors`);
      if (!res.ok) throw new Error('Failed to fetch instructors');
      return res.json();
    },
  });

  // ── 강사 추가 ──────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (data: NewInstructorForm) => {
      const res = await apiFetch(`${API_BASE}/admin/instructors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? '강사 추가에 실패했습니다.');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminInstructors'] });
      setIsModalOpen(false);
      setForm(emptyForm);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  // ── 강사 정보 수정 ─────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async ({ id, name, tags, permissions, studentIds }: { id: string; name: string; tags: string[]; permissions: number; studentIds: string[] }) => {
      const res = await apiFetch(`${API_BASE}/admin/instructors/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tags, permissions, studentIds }),
      });
      if (!res.ok) throw new Error('수정에 실패했습니다.');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminInstructors'] });
      queryClient.invalidateQueries({ queryKey: ['adminStudents'] });
      setEditingInstructor(null);
    },
  });

  // ── 활성/비활성 토글 ───────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiFetch(`${API_BASE}/admin/instructors/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error('상태 변경에 실패했습니다.');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminInstructors'] }),
  });

  // ── 계정 비활성화(삭제) ────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`${API_BASE}/admin/instructors/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('계정 비활성화에 실패했습니다.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminInstructors'] });
      setConfirmDeleteId(null);
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setFormError('모든 항목을 입력해주세요.');
      return;
    }
    if (form.password.length < 8) {
      setFormError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    setFormError(null);
    const payload = {
      ...form,
      tags: form.tags.split(',').map((t: string) => t.trim()).filter(Boolean),
    };
    addMutation.mutate(payload as unknown as NewInstructorForm);
  };

  const openEdit = (inst: Instructor) => {
    setEditingInstructor(inst);
    setEditName(inst.name);
    setEditTags((inst.tags ?? []).join(', '));
    setEditPermissions(inst.permissions ?? 0);
    setEditStudentIds(inst.students?.map((s) => s.id) ?? []);
  };

  const togglePermissionBit = (bit: number) => {
    setEditPermissions((prev: number) => prev ^ bit);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setForm(emptyForm);
    setFormError(null);
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
            <GraduationCap className="text-indigo-600" /> 강사 계정 관리
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            강사를 등록하고 AI 멘토링 시스템 접근 권한을 부여합니다.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-md"
          >
            <UserPlus size={18} /> 강사 추가
          </button>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-20 text-gray-500">
            <Loader2 className="animate-spin mr-2" /> 목록을 불러오는 중...
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center p-20 text-red-500">
            강사 목록을 불러오지 못했습니다.
          </div>
        ) : instructors?.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-gray-400">
            <GraduationCap size={48} className="mb-4 opacity-30" />
            <p>등록된 강사가 없습니다.</p>
            {isAdmin && (
              <button onClick={() => setIsModalOpen(true)} className="mt-4 text-indigo-600 hover:underline text-sm">
                첫 강사 등록하기
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-6 py-4 font-semibold">이름</th>
                <th className="px-6 py-4 font-semibold">이메일</th>
                <th className="px-6 py-4 font-semibold">태그</th>
                <th className="px-6 py-4 font-semibold">담당 수강생</th>
                <th className="px-6 py-4 font-semibold">마지막 로그인</th>
                <th className="px-6 py-4 font-semibold">상태</th>
                <th className="px-6 py-4 font-semibold text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {instructors?.map((inst: Instructor) => (
                <tr key={inst.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-800 dark:text-white">{inst.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">강사</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 dark:text-gray-300 text-sm">{inst.email}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {inst.tags?.length ? (
                        inst.tags.map((tag) => (
                          <span key={tag} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded-full border border-blue-100 dark:border-blue-800">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                    <div className="flex flex-wrap gap-1">
                      {inst.students?.length ? (inst.students.map(s => (<span key={s.id} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{s.displayName}</span>))) : (<span className="text-gray-400">-</span>)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {inst.lastLoginAt
                      ? new Date(inst.lastLoginAt).toLocaleDateString('ko-KR')
                      : '로그인 기록 없음'}
                  </td>
                  <td className="px-6 py-4">
                    {inst.isActive ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full text-xs font-medium">
                        <CheckCircle2 size={12} /> 활성
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full text-xs font-medium">
                        <XCircle size={12} /> 비활성
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right space-x-1">
                    <button
                      onClick={() => setCoursesPopupInstructor(inst)}
                      className="text-gray-400 hover:text-green-600 p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/30 transition"
                      title="담당 과목 보기"
                    >
                      <BookOpen size={16} />
                    </button>
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => openEdit(inst)}
                          className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                          title="정보 수정 / 권한 설정"
                        >
                          <FileEdit size={16} />
                        </button>
                        <button
                          onClick={() => toggleMutation.mutate({ id: inst.id, isActive: !inst.isActive })}
                          className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
                          title={inst.isActive ? '비활성화' : '활성화'}
                        >
                          {inst.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(inst.id)}
                          className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition ml-1"
                          title="계정 비활성화"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 강사 추가 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">신규 강사 등록</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">강사 계정을 생성하면 관리자 포털 접근 및 AI 도구 사용이 가능합니다.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">이름</label>
                <input
                  type="text"
                  autoFocus
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="예) 김철수"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">이메일</label>
                <input
                  type="email"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="예) teacher@school.ac.kr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">초기 비밀번호</label>
                <input
                  type="password"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="최소 8자 이상"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <p className="text-xs text-gray-400 mt-1.5">강사에게 초기 비밀번호를 전달하고, 첫 로그인 후 변경하도록 안내하세요.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">관리 태그 (선택)</label>
                <input
                  type="text"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="쉼표(,)로 구분 (예: 수학, 고등부)"
                  value={form.tags || ''}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{formError}</div>
              )}
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={closeModal} className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition">취소</button>
              <button
                onClick={handleSubmit}
                disabled={addMutation.isPending}
                className="px-4 py-2 font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
              >
                {addMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                등록하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 강사 수정 모달 (이름 + 태그 + 권한) */}
      {editingInstructor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <ShieldCheck size={20} className="text-indigo-600" /> 강사 정보 수정
              </h2>
              <button onClick={() => setEditingInstructor(null)} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">이름</label>
                <input
                  type="text"
                  autoFocus
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">태그 (쉼표 구분)</label>
                <input
                  type="text"
                  className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="예: 수학, 고등부"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                />
              </div>
              {/* Permissions 비트마스크 체크박스 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-indigo-500" /> 접근 권한 (Permissions)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={editPermissions === ALL_PERMISSIONS}
                      onChange={(e) => setEditPermissions(e.target.checked ? ALL_PERMISSIONS : 0)}
                      className="w-4 h-4 rounded accent-indigo-600"
                    />
                    <span className="text-gray-700 dark:text-gray-300 select-none">전체 선택</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 border border-gray-200 dark:border-gray-600">
                  {(Object.entries(PERMISSIONS) as [keyof typeof PERMISSIONS, number][]).map(([key, bit]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={(editPermissions & bit) !== 0}
                        onChange={() => togglePermissionBit(bit)}
                        className="w-4 h-4 rounded accent-indigo-600"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300 group-hover:text-indigo-600 transition">
                        {PERMISSION_LABELS[key]}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">체크된 항목만 해당 강사가 접근할 수 있습니다.</p>
              </div>

              {/* 담당 수강생 선택 */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                  담당 수강생 선택
                </label>
                <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg p-2 space-y-1">
                  {allStudents?.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm p-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded cursor-pointer transition">
                      <input
                        type="checkbox"
                        checked={editStudentIds.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) setEditStudentIds([...editStudentIds, s.id]);
                          else setEditStudentIds(editStudentIds.filter(id => id !== s.id));
                        }}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>
                        {s.displayName}
                        {s.instructorId && s.instructorId !== editingInstructor.id && (
                          <span className="text-xs text-gray-400 ml-1">(타 강사 배정됨)</span>
                        )}
                      </span>
                    </label>
                  ))}
                  {!allStudents?.length && <p className="text-xs text-gray-400">등록된 수강생이 없습니다.</p>}
                </div>
              </div>

            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setEditingInstructor(null)}
                className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                취소
              </button>
              <button
                onClick={() =>
                  editMutation.mutate({
                    id: editingInstructor.id,
                    name: editName.trim(),
                    tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
                    permissions: editPermissions,
                    studentIds: editStudentIds,
                  })
                }
                disabled={editName.trim().length === 0 || editMutation.isPending}
                className="px-4 py-2 font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
              >
                {editMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">계정 비활성화</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              해당 강사 계정을 비활성화합니다. 계정은 삭제되지 않으며 관리자가 다시 활성화할 수 있습니다.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                취소
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDeleteId)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
              >
                {deleteMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                비활성화
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 담당 과목 팝업 */}
      {coursesPopupInstructor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <BookOpen size={18} className="text-green-600" />
                {coursesPopupInstructor.name}의 담당 과목
              </h2>
              <button onClick={() => setCoursesPopupInstructor(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>
            {(coursesPopupInstructor.assignedCourses ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">담당 과목이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {coursesPopupInstructor.assignedCourses!.map((c) => (
                  <li key={c.courseId} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <span className="flex-1 text-sm font-medium text-gray-800 dark:text-white">{c.courseName}</span>
                    <span className="text-xs text-gray-400 bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 px-2 py-0.5 rounded-full">{c.subject}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setCoursesPopupInstructor(null)}
                className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
