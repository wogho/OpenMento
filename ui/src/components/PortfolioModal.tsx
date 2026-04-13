/**
 * PortfolioModal — 수강생용 포트폴리오 작성·조회 모달
 *
 * 탭 1: 내 포트폴리오 목록 (상태 배지 + 선택 → 상세)
 * 탭 2: 새 포트폴리오 작성 (제목 + MDEditor + 파일업로드 + 제출)
 * 상세: 본문(마크다운), 댓글 목록, 에이전트 선택 + AI 댓글 요청
 */
import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MDEditor from '@uiw/react-md-editor';
import {
  X, Plus, FileText, ChevronLeft, Bot, Send, Loader2,
  Paperclip, CheckCircle, Clock, Eye, Pencil, Download,
} from 'lucide-react';


const API = import.meta.env.VITE_API_URL ?? '/api';

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface Post {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'submitted' | 'reviewed';
  fileUrl: string | null;
  fileName: string | null;
  createdAt: string;
  courseId: string;
  courseName: string | null;
}

interface Comment {
  id: string;
  authorType: 'student' | 'instructor' | 'agent';
  authorName: string | null;
  content: string;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  title: string | null;
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` };
}

async function apiFetch(url: string, init?: RequestInit) {
  return fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers ?? {}) } });
}

// ── 상태 배지 ─────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Post['status'] }) {
  const map = {
    draft:     { label: '초안', cls: 'bg-gray-100 text-gray-500', icon: <Clock size={10} /> },
    submitted: { label: '제출됨', cls: 'bg-blue-100 text-blue-600', icon: <Eye size={10} /> },
    reviewed:  { label: '검토완료', cls: 'bg-green-100 text-green-600', icon: <CheckCircle size={10} /> },
  } as const;
  const { label, cls, icon } = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
interface Props {
  courseId: string | null;
  onClose: () => void;
}

export default function PortfolioModal({ courseId, onClose }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  type View = 'list' | 'write' | 'detail';
  const [view, setView] = useState<View>('list');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [commentText, setCommentText] = useState('');

  // 작성 폼 상태
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── 데이터 쿼리 ──
  const { data: myPosts, isLoading: listLoading } = useQuery<{ posts: Post[] }>({
    queryKey: ['my-portfolios'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/portfolio-posts/my`);
      if (!res.ok) throw new Error('목록 조회 실패');
      return res.json();
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery<{ post: Post; comments: Comment[] }>({
    queryKey: ['portfolio-detail', selectedPostId],
    queryFn: async () => {
      const res = await apiFetch(`${API}/portfolio-posts/${selectedPostId}`);
      if (!res.ok) throw new Error('상세 조회 실패');
      return res.json();
    },
    enabled: !!selectedPostId,
    refetchInterval: (query) => {
      const data = query.state.data as { comments: Comment[] } | undefined;
      const hasPending = data?.comments.some(c => c.content.startsWith('⏳')) ?? false;
      return hasPending ? 3000 : false;
    },
  });

  const { data: agentsData } = useQuery<{ agents: Agent[] }>({
    queryKey: ['student-agents', courseId],
    queryFn: async () => {
      const url = courseId ? `${API}/student/courses/${courseId}/agents` : `${API}/admin/agents`;
      const res = await apiFetch(url);
      if (!res.ok) return { agents: [] };
      return res.json();
    },
  });

  // ── 파일 업로드 ──
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/portfolio-posts/upload`, {
        method: 'POST',
        headers: authHeader(),
        body: fd,
      });
      if (!res.ok) throw new Error('업로드 실패');
      const { url, fileName: fn } = await res.json();
      setFileUrl(url);
      setFileName(fn);
    } catch {
      alert('파일 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  // ── 포트폴리오 저장 ──
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/portfolio-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, title, content, fileUrl: fileUrl || undefined, fileName: fileName || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? '저장 실패');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-portfolios'] });
      setTitle(''); setContent(''); setFileUrl(''); setFileName('');
      setView('list');
    },
    onError: (err: Error) => alert(err.message),
  });

  // ── 댓글 작성 ──
  const commentMutation = useMutation({
    mutationFn: async ({ content: c, agentId }: { content: string; agentId?: string }) => {
      const body: Record<string, string> = { content: c };
      if (agentId) body.agentId = agentId;
      const res = await apiFetch(`${API}/portfolio-posts/${selectedPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('댓글 작성 실패');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-detail', selectedPostId] });
      setCommentText('');
    },
  });

  const posts = myPosts?.posts ?? [];
  const agents = agentsData?.agents ?? [];

  function openDetail(id: string) {
    setSelectedPostId(id);
    setView('detail');
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 flex flex-col max-h-[90vh] overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            {(view === 'write' || view === 'detail') && (
              <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-700 mr-1">
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {view === 'list' ? '내 포트폴리오' : view === 'write' ? '새 포트폴리오 작성' : '포트폴리오 상세'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {view === 'list' && (
              <button
                onClick={() => setView('write')}
                disabled={!courseId}
                className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-40"
              >
                <Plus size={13} />새 포트폴리오
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── 목록 뷰 ── */}
          {view === 'list' && (
            <div className="p-4 space-y-2">
              {listLoading && (
                <div className="flex items-center justify-center py-10 text-gray-400 gap-2 text-sm">
                  <Loader2 size={16} className="animate-spin" />로딩 중...
                </div>
              )}
              {!listLoading && posts.length === 0 && (
                <div className="text-center py-10 text-gray-400 text-sm">
                  <FileText size={28} className="mx-auto mb-2 opacity-30" />
                  <p>아직 작성한 포트폴리오가 없습니다.</p>
                  {courseId && <p className="text-xs mt-1">'새 포트폴리오' 버튼으로 작성을 시작하세요.</p>}
                </div>
              )}
              {posts.map(p => (
                <button
                  key={p.id}
                  onClick={() => openDetail(p.id)}
                  className="w-full text-left bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded-xl p-3 flex items-start gap-3 transition"
                >
                  <FileText size={16} className="text-gray-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{p.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{p.courseName ?? '과목 미지정'} · {new Date(p.createdAt).toLocaleDateString('ko-KR')}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </button>
              ))}
            </div>
          )}

          {/* ── 작성 뷰 ── */}
          {view === 'write' && (
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">제목</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="포트폴리오 제목을 입력하세요"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>

              <div data-color-mode="light">
                <label className="text-xs font-medium text-gray-500 mb-1 block">내용</label>
                <MDEditor
                  value={content}
                  onChange={v => setContent(v ?? '')}
                  height={300}
                  preview="edit"
                />
              </div>

              {/* 파일 첨부 */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">첨부파일 (선택)</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                    {uploading ? '업로드 중...' : '파일 선택'}
                  </button>
                  {fileName && <span className="text-xs text-gray-500 truncate max-w-[200px]">{fileName}</span>}
                  {fileName && (
                    <button onClick={() => { setFileUrl(''); setFileName(''); }} className="text-gray-400 hover:text-red-500">
                      <X size={12} />
                    </button>
                  )}
                </div>
                <input type="file" ref={fileRef} className="hidden" onChange={handleFileUpload}
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.zip" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setView('list')}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
                >
                  취소
                </button>
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={!title.trim() || createMutation.isPending}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1"
                >
                  {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                  저장하기
                </button>
              </div>
            </div>
          )}

          {/* ── 상세 뷰 ── */}
          {view === 'detail' && (
            <>
              {detailLoading && (
                <div className="flex items-center justify-center py-10 text-gray-400 gap-2 text-sm">
                  <Loader2 size={16} className="animate-spin" />로딩 중...
                </div>
              )}
              {detail && (
                <div className="p-5 space-y-4">
                  {/* 헤더 */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{detail.post.title}</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">{detail.post.courseName} · {new Date(detail.post.createdAt).toLocaleDateString('ko-KR')}</p>
                    </div>
                    <StatusBadge status={detail.post.status} />
                  </div>

                  {detail.post.fileUrl && (
                    <a
                      href={detail.post.fileUrl.startsWith('http') ? detail.post.fileUrl : `${API.replace('/api', '')}${detail.post.fileUrl}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                    >
                      <Download size={12} />{detail.post.fileName ?? '첨부파일'}
                    </a>
                  )}

                  <div data-color-mode="light" className="prose prose-sm max-w-none">
                    <MDEditor.Markdown source={detail.post.content || '(내용 없음)'} />
                  </div>

                  {/* 댓글 */}
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                      피드백 ({detail.comments.length})
                    </p>
                    <div className="space-y-2 mb-4">
                      {detail.comments.length === 0 && (
                        <p className="text-xs text-gray-400">아직 피드백이 없습니다.</p>
                      )}
                      {detail.comments.map(c => {
                        const isPending = c.content.startsWith('⏳');
                        return (
                        <div key={c.id} className={`rounded-xl p-3 text-sm ${isPending ? 'bg-yellow-50 border border-yellow-200' : c.authorType === 'agent' ? 'bg-purple-50 border border-purple-100' : c.authorType === 'instructor' ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {isPending
                              ? <Loader2 size={11} className="text-yellow-500 animate-spin" />
                              : c.authorType === 'agent' ? <Bot size={11} className="text-purple-500" />
                              : c.authorType === 'instructor' ? <Pencil size={11} className="text-blue-500" /> : null}
                            <span className="text-[11px] font-semibold text-gray-700">
                              {c.authorType === 'agent' ? `AI · ${c.authorName ?? '에이전트'}` : c.authorName ?? '강사'}
                            </span>
                            {isPending && <span className="text-[10px] text-yellow-600 animate-pulse">분석 중...</span>}
                            <span className="text-[10px] text-gray-400 ml-auto">{new Date(c.createdAt).toLocaleString('ko-KR')}</span>
                          </div>
                          <MDEditor.Markdown source={c.content} />
                        </div>
                        );
                      })}
                    </div>

                    {/* AI 피드백 요청 */}
                    {agents.length > 0 && (
                      <div className="space-y-2 mt-3">
                        <div className="flex items-center gap-2">
                          <Bot size={13} className="text-purple-400" />
                          <select
                            value={selectedAgentId}
                            onChange={e => setSelectedAgentId(e.target.value)}
                            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white dark:bg-slate-800"
                          >
                            <option value="">에이전트 선택 (AI 피드백 요청)</option>
                            {agents.map(a => (
                              <option key={a.id} value={a.id}>{a.name}{a.title ? ` (${a.title})` : ''}</option>
                            ))}
                          </select>
                        </div>

                        {selectedAgentId && (
                          <div className="flex gap-2">
                            <input
                              value={commentText}
                              onChange={e => setCommentText(e.target.value)}
                              placeholder="에이전트에게 보낼 메시지 (예: 구조를 분석해줘)"
                              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey && commentText.trim()) {
                                  e.preventDefault();
                                  commentMutation.mutate({ content: commentText, agentId: selectedAgentId });
                                }
                              }}
                            />
                            <button
                              onClick={() => commentMutation.mutate({ content: commentText, agentId: selectedAgentId })}
                              disabled={!commentText.trim() || commentMutation.isPending}
                              className="px-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-40"
                            >
                              {commentMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
