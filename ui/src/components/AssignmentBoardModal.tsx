/**
 * 과제 공지사항 커뮤니티 모달
 *
 * - 과제 상세 (제목, 내용, 첨부파일, 제출기한)
 * - 스레드 형식 댓글 (대댓글 지원)
 * - 강사/수강생 모두 댓글 작성 가능
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Paperclip, MessageSquare, CornerDownRight, Send, Sparkles, Pencil, Trash2, AlertTriangle, Check } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import { useAuth } from '../hooks/useAuth';

const API = import.meta.env.VITE_API_URL ?? '/api';

interface Comment {
  id: string;
  content: string;
  authorRole: 'instructor' | 'student';
  parentId: string | null;
  createdAt: string;
  instructorName: string | null;
  studentName: string | null;
}

interface AssignmentDetail {
  id: string;
  title: string;
  content: string;
  fileUrl: string | null;
  fileName: string | null;
  dueAt: string | null;
  isPublished: boolean;
  createdAt: string;
  instructorId: string;
  instructorName?: string | null;
}

interface AssignmentDetailResponse {
  assignment: AssignmentDetail;
  comments: Comment[];
}

interface AssignmentBoardModalProps {
  assignmentId: string;
  onClose: () => void;
  onAnalyze: (title: string) => void;
  /** 과제 삭제 성공 시 콜백 (목록 질보리 갱신용) */
  onDeleted?: () => void;
}

// 댓글 표시용 이름
function authorLabel(c: Comment): string {
  if (c.authorRole === 'instructor') return c.instructorName ?? '강사';
  return c.studentName ?? '수강생';
}

// 날짜 포맷
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── 댓글 단일 아이템 ────────────────────────────────────────────────────────

function CommentItem({
  comment,
  replies,
  onReply,
}: {
  comment: Comment;
  replies: Comment[];
  onReply: (parentId: string) => void;
}) {
  const isInstructor = comment.authorRole === 'instructor';
  return (
    <div className="group">
      <div className={`flex gap-2 ${isInstructor ? '' : 'pl-0'}`}>
        <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
          ${isInstructor ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
          {isInstructor ? '강' : '수'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-xs font-semibold ${isInstructor ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}`}>
              {authorLabel(comment)}
            </span>
            {isInstructor && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">강사</span>
            )}
            <span className="text-[10px] text-gray-400">{fmtDate(comment.createdAt)}</span>
          </div>
          <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{comment.content}</p>
          <button
            onClick={() => onReply(comment.id)}
            className="mt-1 text-[11px] text-gray-400 hover:text-blue-500 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition"
          >
            <CornerDownRight size={11} /> 답글
          </button>
        </div>
      </div>

      {/* 대댓글 */}
      {replies.length > 0 && (
        <div className="ml-9 mt-1.5 space-y-1.5 pl-3 border-l-2 border-gray-100 dark:border-slate-700">
          {replies.map((r) => (
            <div key={r.id} className="flex gap-2">
              <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
                ${r.authorRole === 'instructor' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                {r.authorRole === 'instructor' ? '강' : '수'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[11px] font-semibold ${r.authorRole === 'instructor' ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}`}>
                    {authorLabel(r)}
                  </span>
                  <span className="text-[10px] text-gray-400">{fmtDate(r.createdAt)}</span>
                </div>
                <p className="text-xs text-gray-800 dark:text-gray-100 whitespace-pre-wrap">{r.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 메인 모달 ───────────────────────────────────────────────────────────────

export default function AssignmentBoardModal({
  assignmentId,
  onClose,
  onAnalyze,
  onDeleted,
}: AssignmentBoardModalProps) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const token = localStorage.getItem('openmento_token') ?? '';
  const isInstructor = user?.role === 'teacher' || user?.role === 'admin';

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // ── 편집 모드 상태 ───────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editDueAt, setEditDueAt] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const detailQ = useQuery<AssignmentDetailResponse>({
    queryKey: ['assignment-detail', assignmentId],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments/${assignmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('과제를 불러오지 못했습니다.');
      return res.json() as Promise<AssignmentDetailResponse>;
    },
    refetchInterval: 10_000,
  });

  const postCommentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId: string | null }) => {
      const res = await fetch(`${API}/assignments/${assignmentId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content, parentId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? '댓글 작성 실패');
      }
      return res.json();
    },
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      void qc.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] });
    },
  });

  // ── 과제 수정 mutation ─────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; dueAt: string | null }) => {
      const res = await fetch(`${API}/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? '수정 실패');
      }
      return res.json();
    },
    onSuccess: () => {
      setIsEditing(false);
      void qc.invalidateQueries({ queryKey: ['assignment-detail', assignmentId] });
      void qc.invalidateQueries({ queryKey: ['assignments'] });
    },
  });

  // ── 과제 삭제 mutation ─────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/assignments/${assignmentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? '삭제 실패');
      }
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      onDeleted?.();
      onClose();
    },
  });

  const assignment = detailQ.data?.assignment;
  const allComments = detailQ.data?.comments ?? [];
  const topLevel = allComments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => allComments.filter((c) => c.parentId === id);

  // 수정폼 열기: 현재 값으로 초기화
  const handleOpenEdit = () => {
    if (!assignment) return;
    setEditTitle(assignment.title);
    setEditContent(assignment.content);
    setEditDueAt(assignment.dueAt ? new Date(assignment.dueAt).toISOString().slice(0, 16) : '');
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editTitle.trim() || !editContent.trim()) return;
    editMutation.mutate({
      title: editTitle.trim(),
      content: editContent.trim(),
      dueAt: editDueAt ? new Date(editDueAt).toISOString() : null,
    });
  };

  const handleSubmit = () => {
    if (!draft.trim()) return;
    postCommentMutation.mutate({ content: draft.trim(), parentId: replyTo });
  };

  // 소유자 여부 (admin은 언제나 가능, teacher는 직접 등록한 과제만)
  const canModify = user?.role === 'admin' ||
    (user?.role === 'teacher' && assignment?.instructorId === user?.sub);

  return (
    <>
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">

        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex items-start justify-between gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                과제 공지
              </span>
              {assignment?.dueAt && (
                <span className="text-[10px] text-gray-400">
                  마감: {new Date(assignment.dueAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 line-clamp-2">
              {assignment?.title ?? '로딩 중...'}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {assignment && (
              <button
                onClick={() => { onAnalyze(assignment.title); onClose(); }}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50 font-medium transition"
              >
                <Sparkles size={12} /> AI 분석
              </button>
            )}
            {/* 강사/관리자 전용: 수정/삭제 */}
            {isInstructor && canModify && !isEditing && (
              <>
                <button
                  onClick={handleOpenEdit}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 font-medium transition"
                  title="과제 수정"
                >
                  <Pencil size={12} /> 수정
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 font-medium transition"
                  title="과제 삭제"
                >
                  <Trash2 size={12} /> 삭제
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 transition"
              aria-label="닫기"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 과제 내용 — 일반 보기 또는 편집 폼 */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0 max-h-[340px] overflow-y-auto">
          {detailQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              내용 불러오는 중...
            </div>
          ) : isEditing ? (
            /* ── 편집 폼 ─────────────────────────────────────────────── */
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">제목</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 dark:text-gray-100"
                  placeholder="과제 제목"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">내용</label>
                <div data-color-mode="auto">
                  <MDEditor
                    value={editContent}
                    onChange={(v) => setEditContent(v ?? '')}
                    preview="edit"
                    height={160}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">제출 기한 (선택)</label>
                <input
                  type="datetime-local"
                  value={editDueAt}
                  onChange={(e) => setEditDueAt(e.target.value)}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 dark:text-gray-100"
                />
              </div>
              {editMutation.isError && (
                <p className="text-xs text-red-500">{(editMutation.error as Error).message}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
                >
                  취소
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={!editTitle.trim() || !editContent.trim() || editMutation.isPending}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition font-medium"
                >
                  <Check size={12} /> 저장
                </button>
              </div>
            </div>
          ) : (
            /* ── 일반 보기 ───────────────────────────────────────────── */
            <>
              <div data-color-mode="auto">
                <MDEditor.Markdown
                  source={assignment?.content ?? ''}
                  style={{ background: 'transparent', fontSize: 13, lineHeight: '1.7' }}
                />
              </div>
              {assignment?.fileUrl && (
                <a
                  href={assignment.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition"
                >
                  <Paperclip size={12} />
                  {assignment.fileName ?? '첨부파일 다운로드'}
                </a>
              )}
            </>
          )}
        </div>

        {/* 댓글 목록 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          <div className="flex items-center gap-1.5 mb-1">
            <MessageSquare size={13} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-500">댓글 {allComments.length}개</span>
          </div>
          {detailQ.isLoading && (
            <p className="text-xs text-gray-400 text-center py-4">댓글 불러오는 중...</p>
          )}
          {!detailQ.isLoading && topLevel.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>
          )}
          {topLevel.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              replies={repliesOf(c.id)}
              onReply={(id) => {
                setReplyTo(id);
                setDraft('');
              }}
            />
          ))}
        </div>

        {/* 댓글 입력 */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-slate-800 shrink-0">
          {replyTo && (
            <div className="flex items-center gap-1.5 mb-2 text-[11px] text-blue-600 dark:text-blue-400">
              <CornerDownRight size={11} />
              <span>
                {allComments.find((c) => c.id === replyTo) ? `"${allComments.find((c) => c.id === replyTo)?.content.slice(0, 30)}..."에 답글` : '답글 작성 중'}
              </span>
              <button
                onClick={() => { setReplyTo(null); setDraft(''); }}
                className="ml-auto text-gray-400 hover:text-gray-600"
              >
                취소
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={replyTo ? '답글을 입력하세요 (Ctrl+Enter 전송)' : '댓글을 입력하세요 (Ctrl+Enter 전송)'}
              className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-300 dark:text-gray-100"
            />
            <button
              onClick={handleSubmit}
              disabled={!draft.trim() || postCommentMutation.isPending}
              className="shrink-0 p-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 transition"
            >
              <Send size={15} />
            </button>
          </div>
          {postCommentMutation.isError && (
            <p className="text-xs text-red-500 mt-1">{(postCommentMutation.error as Error).message}</p>
          )}
        </div>
      </div>
    </div>

    {/* 삭제 확인 다이얼로그 */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 p-6 max-w-sm w-full mx-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">과제를 삭제할까요?</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">삭제된 과제는 복구할 수 없습니다.</p>
            </div>
          </div>
          {deleteMutation.isError && (
            <p className="text-xs text-red-500 mb-3">{(deleteMutation.error as Error).message}</p>
          )}
          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="text-sm px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
            >
              취소
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="text-sm px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition font-medium"
            >
              {deleteMutation.isPending ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
}
