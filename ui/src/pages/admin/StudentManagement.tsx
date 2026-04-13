import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus, FileEdit, Trash2, Loader2, BrainCircuit, Copy, Check, X, BookOpen, MessageCircle, ClipboardList } from 'lucide-react';
import StudentSkillModal from './StudentSkillModal';
import { apiFetch } from '../../lib/apiFetch';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

interface Student {
  id: string;
  anonymousId: string;
  displayName: string;
  courseId: string | null;
  tags?: string[] | null;
  email?: string | null;
  instructorId?: string | null;
  enrolledCourses?: { courseId: string; courseName: string; subject: string }[];
}

interface StudentManagementProps {
  onOpenChat?: (notificationId: string) => void;
  /** studentId → { notificationId, accepted } 매핑 */
  pendingCallsByStudentId?: Record<string, { notificationId: string; accepted: boolean }>;
}

export default function StudentManagement({
  onOpenChat,
  pendingCallsByStudentId = {},
}: StudentManagementProps = {}) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedEditUrl, setCopiedEditUrl] = useState(false);

  // 수정 상태
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editInstructorId, setEditInstructorId] = useState<string | null>(null);

  // 삭제 확인 상태
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 제출 과제 현황 모달
  const [submissionsStudent, setSubmissionsStudent] = useState<Student | null>(null);

  const [selectedStudentForSkills, setSelectedStudentForSkills] = useState<{ id: string; displayName: string } | null>(null);
  const [coursesPopupStudent, setCoursesPopupStudent] = useState<Student | null>(null);
  const queryClient = useQueryClient();

  const { data: instructors } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["adminInstructors"],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/instructors`);
      return res.json();
    },
  });

  const { data: students, isLoading, isError } = useQuery<Student[]>({
    queryKey: ['adminStudents'],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/students`);
      if (!res.ok) throw new Error('Failed to fetch students');
      return res.json();
    },
  });

  // 학생 추가
  const addStudentMutation = useMutation({
    mutationFn: async (displayName: string) => {
      const res = await apiFetch(`${API_BASE}/admin/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) throw new Error('Failed to add student');
      return res.json() as Promise<Student & { inviteUrl?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['adminStudents'] });
      setNewDisplayName('');
      if (data.inviteUrl) setInviteUrl(data.inviteUrl);
    },
  });

  // 학생 정보 수정
  const updateStudentMutation = useMutation({
    mutationFn: async ({ id, displayName, tags, instructorId }: { id: string; displayName: string, tags: string[], instructorId: string | null }) => {
      const res = await apiFetch(`${API_BASE}/admin/students/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, tags, instructorId }),
      });
      if (!res.ok) throw new Error('수정에 실패했습니다.');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminStudents'] });
      queryClient.invalidateQueries({ queryKey: ['adminInstructors'] });
      setEditingStudent(null);
    },
  });

  // 학생 삭제 (soft delete)
  const deleteStudentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`${API_BASE}/admin/students/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('삭제에 실패했습니다.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminStudents'] });
      setConfirmDeleteId(null);
    },
  });

  const handleCopyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyEditUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedEditUrl(true);
    setTimeout(() => setCopiedEditUrl(false), 2000);
  };

  const openEdit = (s: Student) => {
    setEditingStudent(s);
    setEditName(s.displayName ?? '');
    setEditTags((s.tags ?? []).join(', '));
    setEditInstructorId(s.instructorId ?? null);
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-3">
            <Users className="text-blue-600" /> 학생 관리
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">플랫폼에 접속할 수강생 목록 관리 및 등록</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex flex-row items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-md"
        >
          <UserPlus size={18} /> 학생 추가
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-20 text-gray-500">
            <Loader2 className="animate-spin mr-2" /> 목록을 불러오는 중...
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center p-20 text-red-500">학생 목록을 불러오지 못했습니다.</div>
        ) : students?.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-gray-400">
            <Users size={48} className="mb-4 opacity-30" />
            <p>등록된 학생이 아직 없습니다.</p>
            <button onClick={() => setIsAddModalOpen(true)} className="mt-4 text-blue-600 hover:underline">첫 학생 추가하기</button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-6 py-4 font-semibold">이름</th>
                <th className="px-6 py-4 font-semibold">익명 ID</th>
                <th className="px-6 py-4 font-semibold">태그</th>
                <th className="px-6 py-4 font-semibold">담당 강사</th>
                <th className="px-6 py-4 text-right font-semibold">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {students?.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-gray-800 dark:text-white">{s.displayName ?? '이름없음'}</div>
                    {!s.email && (
                      <span className="mt-1 inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700">
                        미가입
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-sm font-mono tracking-tight w-[40%]">
                    <div className="truncate w-full max-w-[250px] sm:max-w-[300px] lg:max-w-full" title={s.anonymousId}>
                      {s.anonymousId}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {s.tags?.length ? (
                        s.tags.map((tag) => (
                          <span key={tag} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded-full border border-blue-100 dark:border-blue-800">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{instructors?.find(i => i.id === s.instructorId)?.name || <span className="text-gray-400">-</span>}</td>
                  <td className="px-6 py-4 text-right space-x-1 whitespace-nowrap">
                    {/* 강사 1:1 채팅 버튼 — 수강생이 호출했을 때 활성화 */}
                    {onOpenChat && pendingCallsByStudentId[s.id] && (
                      <button
                        onClick={() => onOpenChat(pendingCallsByStudentId[s.id]!.notificationId)}
                        className={`inline-flex items-center gap-1 p-2 rounded-lg transition ${
                          !pendingCallsByStudentId[s.id]!.accepted
                            ? 'text-amber-600 bg-amber-50 hover:bg-amber-100 animate-pulse'
                            : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                        title={pendingCallsByStudentId[s.id]!.accepted ? '1:1 채팅 열기' : '채팅 요청 수락 후 입장'}
                      >
                        <MessageCircle size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => setCoursesPopupStudent(s)}
                      className="text-gray-400 hover:text-green-600 p-2 rounded-lg hover:bg-green-50 transition"
                      title="수강 과목 보기"
                    >
                      <BookOpen size={16} />
                    </button>
                    <button
                      onClick={() => setSubmissionsStudent(s)}
                      className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition"
                      title="제출 과제 현황 보기"
                    >
                      <ClipboardList size={16} />
                    </button>
                    <button
                      onClick={() => setSelectedStudentForSkills({ id: s.id, displayName: s.displayName })}
                      className="text-gray-400 hover:text-purple-600 p-2 rounded-lg hover:bg-purple-50 transition"
                      title="맞춤 튜터 스킬 설정"
                    >
                      <BrainCircuit size={16} />
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="text-gray-400 hover:text-blue-600 p-2 rounded-lg hover:bg-blue-50 transition"
                      title="학생 정보 수정"
                    >
                      <FileEdit size={16} />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(s.id)}
                      className="text-gray-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition"
                      title="학생 삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 학생 추가 모달 */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            {inviteUrl ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">학생 추가 완료</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">아래 URL을 수강생에게 공유하면 수강생이 직접 계정을 완성할 수 있습니다.</p>
                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 break-all">{inviteUrl}</span>
                  <button
                    onClick={() => handleCopyUrl(inviteUrl)}
                    className="text-blue-600 hover:text-blue-700 p-1 flex-shrink-0"
                    title="URL 복사"
                  >
                    {copiedUrl ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </button>
                </div>
                <div className="flex justify-end mt-5">
                  <button
                    onClick={() => { setInviteUrl(null); setIsAddModalOpen(false); }}
                    className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                  >
                    확인
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">신규 학생 추가</h2>
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">학생 이름</label>
                  <input
                    type="text"
                    autoFocus
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                    placeholder="예) 홍길동"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && newDisplayName.trim().length > 0 && addStudentMutation.mutate(newDisplayName.trim())}
                  />
                  <p className="text-xs text-gray-500 mt-2">이름은 강사 편의용으로만 사용되며, 모든 AI 로직은 고유 익명 ID로 수행됩니다.</p>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => { setIsAddModalOpen(false); setNewDisplayName(''); }}
                    className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => addStudentMutation.mutate(newDisplayName.trim())}
                    disabled={newDisplayName.trim().length === 0 || addStudentMutation.isPending}
                    className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition flex items-center"
                  >
                    {addStudentMutation.isPending && <Loader2 size={16} className="animate-spin mr-2" />}
                    추가하기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 학생 수정 모달 */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">학생 정보 수정</h2>
              <button onClick={() => setEditingStudent(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">표시 이름</label>
              <input
                type="text"
                autoFocus
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && editName.trim().length > 0 && updateStudentMutation.mutate({ id: editingStudent.id, displayName: editName.trim(), tags: editTags.split(',').map((t) => t.trim()).filter(Boolean), instructorId: editInstructorId })}
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">태그</label>
              <input
                type="text"
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition"
                placeholder="쉼표(,)로 구분 (예: 수학, 고등부)"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && editName.trim().length > 0 && updateStudentMutation.mutate({ id: editingStudent.id, displayName: editName.trim(), tags: editTags.split(',').map((t) => t.trim()).filter(Boolean), instructorId: editInstructorId })}
              />
            </div>
            
            {/* 담당 강사 선택 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">담당 강사 지정</label>
              <select
                value={editInstructorId ?? ''}
                onChange={(e) => setEditInstructorId(e.target.value || null)}
                className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition"
              >
                <option value="">— 담당 강사 없음 —</option>
                {instructors?.map(inst => (
                  <option key={inst.id} value={inst.id}>{inst.name}</option>
                ))}
              </select>
            </div>

            {/* 초대 URL — 아직 미가입 수강생에게만 표시 */}
            {!editingStudent.email && (() => {
              const editInviteUrl = `${window.location.origin}/register?token=${editingStudent.anonymousId}`;
              return (
                <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                    <span>초대 링크 (미가입)</span>
                    <span className="font-normal opacity-70">— 가입 완료 시 자동 소멸</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 break-all font-mono">{editInviteUrl}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyEditUrl(editInviteUrl)}
                      className="shrink-0 text-amber-600 hover:text-amber-700 p-1"
                      title="링크 복사"
                    >
                      {copiedEditUrl ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
                    </button>
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setEditingStudent(null)}
                className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                취소
              </button>
              <button
                onClick={() => updateStudentMutation.mutate({ id: editingStudent.id, displayName: editName.trim(), tags: editTags.split(',').map((t) => t.trim()).filter(Boolean), instructorId: editInstructorId })}
                disabled={editName.trim().length === 0 || updateStudentMutation.isPending}
                className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
              >
                {updateStudentMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 학생 삭제 확인 모달 */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">수강생 삭제</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              해당 수강생 계정을 삭제합니다. 채팅 기록 등 연결된 데이터는 보존됩니다.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                취소
              </button>
              <button
                onClick={() => deleteStudentMutation.mutate(confirmDeleteId)}
                disabled={deleteStudentMutation.isPending}
                className="px-4 py-2 font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition flex items-center gap-2"
              >
                {deleteStudentMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedStudentForSkills && (
        <StudentSkillModal
          student={selectedStudentForSkills}
          onClose={() => setSelectedStudentForSkills(null)}
        />
      )}

      {/* 제출 과제 현황 모달 */}
      {submissionsStudent && (
        <StudentSubmissionsModal
          student={submissionsStudent}
          onClose={() => setSubmissionsStudent(null)}
        />
      )}

      {/* 수강 과목 팝업 */}
      {coursesPopupStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <BookOpen size={18} className="text-green-600" />
                {coursesPopupStudent.displayName}의 수강 과목
              </h2>
              <button onClick={() => setCoursesPopupStudent(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <X size={20} />
              </button>
            </div>
            {(coursesPopupStudent.enrolledCourses ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">등록된 수강 과목이 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {coursesPopupStudent.enrolledCourses!.map((c) => (
                  <li key={c.courseId} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <span className="flex-1 text-sm font-medium text-gray-800 dark:text-white">{c.courseName}</span>
                    <span className="text-xs text-gray-400 bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 px-2 py-0.5 rounded-full">{c.subject}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setCoursesPopupStudent(null)}
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

// ── 제출 과제 현황 모달 ────────────────────────────────────────────────────────

const API_BASE_SM = import.meta.env.VITE_API_URL ?? '/api';

interface Submission {
  commentId: string;
  content: string;
  createdAt: string;
  assignmentId: string;
  assignmentTitle: string;
  dueAt: string | null;
  courseName: string;
  courseId: string;
}

function StudentSubmissionsModal({
  student,
  onClose,
}: {
  student: { id: string; displayName: string };
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ submissions: Submission[] }>({
    queryKey: ['studentSubmissions', student.id],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE_SM}/admin/students/${student.id}/submissions`);
      if (!res.ok) throw new Error('조회 실패');
      return res.json();
    },
  });

  const submissions = data?.submissions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardList size={18} className="text-indigo-600" />
            {student.displayName}의 제출 과제
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="animate-spin mr-2" size={18} /> 불러오는 중...
            </div>
          )}
          {!isLoading && submissions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm">
              <ClipboardList size={36} className="mb-3 opacity-30" />
              아직 제출한 과제가 없습니다.
            </div>
          )}
          {!isLoading && submissions.length > 0 && (
            <div className="space-y-3">
              {submissions.map((s) => (
                <div key={s.commentId} className="border border-gray-100 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-700/40">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">{s.assignmentTitle}</p>
                    <span className="text-xs text-gray-400 shrink-0">{new Date(s.createdAt).toLocaleDateString('ko-KR')}</span>
                  </div>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-2">{s.courseName}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line line-clamp-3">{s.content}</p>
                  {s.dueAt && (
                    <p className="text-xs text-gray-400 mt-2">
                      제출 기한: {new Date(s.dueAt).toLocaleDateString('ko-KR')}
                      {new Date(s.createdAt) > new Date(s.dueAt) && (
                        <span className="ml-1 text-red-500 font-medium">(지각)</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-4 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 rounded-lg transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
