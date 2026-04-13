/**
 * PortfolioManagement — 강사/관리자용 포트폴리오 관리 페이지
 *
 * - 수강생별 포트폴리오 목록 토글 (수강생명 | 포트폴리오명 | 과목-강사)
 * - 선택 시 본문(마크다운 렌더), 첨부파일 다운로드, 댓글 목록
 * - 에이전트 선택 → 전송 → AI 댓글 생성
 * - 강사가 직접 댓글 작성
 * - 상태 변경: submitted / reviewed
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Bot, Send,
  FileText, MessageSquare, CheckCircle, Clock, Eye,
  Download, Filter
} from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import { apiFetch } from '../../lib/apiFetch';
import { useTheme } from '../../components/theme-provider';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface PortfolioPost {
  id: string;
  title: string;
  status: 'draft' | 'submitted' | 'reviewed';
  fileUrl: string | null;
  fileName: string | null;
  createdAt: string;
  updatedAt: string;
  courseId: string;
  courseName: string | null;
  studentId: string;
  studentName: string | null;
}

interface PostDetail extends PortfolioPost {
  content: string;
}

interface Comment {
  id: string;
  authorType: 'student' | 'instructor' | 'agent';
  authorName: string | null;
  agentId: string | null;
  content: string;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  title: string | null;
}

// ── 상태 배지 ─────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PortfolioPost['status'] }) {
  const map: Record<PortfolioPost['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    draft:     { label: '초안', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300', icon: <Clock size={11} /> },
    submitted: { label: '제출됨', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', icon: <Eye size={11} /> },
    reviewed:  { label: '검토완료', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300', icon: <CheckCircle size={11} /> },
  };
  const { label, cls, icon } = map[status] ?? map.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
export default function PortfolioManagement() {
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const colorMode = theme === 'dark' ? 'dark' : 'light';
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [filterCourseId, setFilterCourseId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [commentText, setCommentText] = useState('');

  // 포트폴리오 전체 목록
  const { data: postsData, isLoading } = useQuery<{ posts: PortfolioPost[] }>({
    queryKey: ['portfolio-posts-admin', filterCourseId],
    queryFn: async () => {
      const url = filterCourseId
        ? `${API_BASE}/portfolio-posts/admin/all?courseId=${filterCourseId}`
        : `${API_BASE}/portfolio-posts/admin/all`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('목록 조회 실패');
      return res.json();
    },
  });

  // 포트폴리오 상세 (선택 시) — AI 처리 중인 댓글이 있으면 3초마다 폴링
  const { data: detail, isLoading: detailLoading } = useQuery<{ post: PostDetail; comments: Comment[] }>({
    queryKey: ['portfolio-post-detail', selectedPostId],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/portfolio-posts/${selectedPostId}`);
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

  // 에이전트 목록
  const { data: agentsData } = useQuery<{ agents: Agent[] }>({
    queryKey: ['agents-list'],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/agents`);
      if (!res.ok) throw new Error('에이전트 조회 실패');
      return res.json();
    },
  });

  // 댓글 작성 (일반 or AI)
  const commentMutation = useMutation({
    mutationFn: async ({ content, agentId }: { content: string; agentId?: string }) => {
      const body: Record<string, string> = { content };
      if (agentId) body.agentId = agentId;
      const res = await apiFetch(`${API_BASE}/portfolio-posts/${selectedPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('댓글 작성 실패');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-post-detail', selectedPostId] });
      setCommentText('');
    },
  });

  // 상태 변경
  const statusMutation = useMutation({
    mutationFn: async (status: 'submitted' | 'reviewed') => {
      const res = await apiFetch(`${API_BASE}/portfolio-posts/${selectedPostId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('상태 변경 실패');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-posts-admin', filterCourseId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-post-detail', selectedPostId] });
    },
  });

  // 수강생별로 그룹화
  const posts = postsData?.posts ?? [];
  const grouped = posts.reduce<Record<string, { studentName: string; posts: PortfolioPost[] }>>((acc, p) => {
    if (!acc[p.studentId]) acc[p.studentId] = { studentName: p.studentName ?? '(이름 없음)', posts: [] };
    acc[p.studentId].posts.push(p);
    return acc;
  }, {});

  return (
    <div className="flex h-full gap-4 p-4">
      {/* 좌측 목록 */}
      <div className="w-80 shrink-0 flex flex-col gap-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-sm text-gray-800 dark:text-gray-100">포트폴리오 관리</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{posts.length}개</span>
        </div>

        {/* 필터 */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400">
          <Filter size={12} />
          <input
            value={filterCourseId}
            onChange={e => setFilterCourseId(e.target.value)}
            placeholder="과목 ID 필터 (선택)"
            className="flex-1 outline-none bg-transparent text-xs text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
            <Loader2 size={14} className="animate-spin" />
            로딩 중...
          </div>
        )}

        {Object.entries(grouped).map(([studentId, { studentName, posts: sPosts }]) => (
          <div key={studentId} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {/* 수강생 헤더 */}
            <button
              onClick={() => setExpandedStudent(expandedStudent === studentId ? null : studentId)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-xs font-bold text-indigo-600 dark:text-indigo-300 shrink-0">
                  {studentName[0]}
                </div>
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{studentName}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{sPosts.length}</span>
              </div>
              {expandedStudent === studentId ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
            </button>

            {/* 포트폴리오 목록 */}
            {expandedStudent === studentId && (
              <div className="border-t border-gray-100 dark:border-gray-700">
                {sPosts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPostId(p.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-start gap-2 border-b border-gray-50 dark:border-gray-700/50 last:border-b-0 ${selectedPostId === p.id ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''}`}
                  >
                    <FileText size={13} className="text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{p.title}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">{p.courseName ?? '과목 미지정'}</p>
                    </div>
                    <div className="ml-auto shrink-0">
                      <StatusBadge status={p.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {!isLoading && posts.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">포트폴리오가 없습니다.</p>
        )}
      </div>

      {/* 우측 상세 */}
      <div className="flex-1 overflow-y-auto">
        {!selectedPostId && (
          <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm flex-col gap-2">
            <FileText size={32} className="opacity-30" />
            <p>포트폴리오를 선택하세요</p>
          </div>
        )}

        {selectedPostId && detailLoading && (
          <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
            <Loader2 size={16} className="animate-spin" />로딩 중...
          </div>
        )}

        {selectedPostId && detail && (
          <div className="flex flex-col gap-4">
            {/* 헤더 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{detail.post.title}</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {detail.post.studentName} · {detail.post.courseName} ·{' '}
                    {new Date(detail.post.createdAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={detail.post.status} />
                  {detail.post.status === 'submitted' && (
                    <button
                      onClick={() => statusMutation.mutate('reviewed')}
                      disabled={statusMutation.isPending}
                      className="px-3 py-1 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      검토완료 처리
                    </button>
                  )}
                </div>
              </div>

              {/* 첨부파일 */}
              {detail.post.fileUrl && (
                <a
                  href={detail.post.fileUrl.startsWith('http') ? detail.post.fileUrl : `${API_BASE.replace('/api', '')}${detail.post.fileUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Download size={12} />
                  {detail.post.fileName ?? '첨부파일'}
                </a>
              )}
            </div>

            {/* 본문 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">내용</h4>
              <div data-color-mode={colorMode} className="prose prose-sm max-w-none text-gray-800 dark:text-gray-200">
                <MDEditor.Markdown source={detail.post.content || '(내용 없음)'} />
              </div>
            </div>

            {/* 댓글 목록 */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={14} className="text-gray-400" />
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">댓글 ({detail.comments.length})</h4>
              </div>

              <div className="space-y-3 mb-4">
                {detail.comments.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">아직 댓글이 없습니다.</p>
                )}
                {detail.comments.map(c => {
                  const isPending = c.content.startsWith('\u23f3');
                  return (
                  <div key={c.id} className={`rounded-lg p-3 text-sm ${
                    isPending
                      ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700'
                      : c.authorType === 'agent'
                      ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-700'
                      : c.authorType === 'student'
                      ? 'bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600'
                      : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-700'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {isPending
                        ? <Loader2 size={12} className="text-yellow-500 animate-spin" />
                        : c.authorType === 'agent' && <Bot size={12} className="text-purple-500 dark:text-purple-400" />}
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                        {c.authorType === 'agent' ? `AI: ${c.authorName ?? '에이전트'}` : c.authorName ?? '(이름 없음)'}
                      </span>
                      {isPending && <span className="text-[10px] text-yellow-600 dark:text-yellow-400">분석 중...</span>}
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">{new Date(c.createdAt).toLocaleString('ko-KR')}</span>
                    </div>
                    <div data-color-mode={colorMode} className="prose prose-xs max-w-none text-gray-700 dark:text-gray-300 text-xs">
                      <MDEditor.Markdown source={c.content} />
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* 댓글 작성 */}
              <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-2">
                {/* AI 에이전트 선택 */}
                <div className="flex items-center gap-2">
                  <Bot size={13} className="text-purple-400 shrink-0" />
                  <select
                    value={selectedAgentId}
                    onChange={e => setSelectedAgentId(e.target.value)}
                    className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                  >
                    <option value="">강사 댓글 (AI 없음)</option>
                    {(agentsData?.agents ?? []).map(a => (
                      <option key={a.id} value={a.id}>{a.name}{a.title ? ` (${a.title})` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2">
                  <textarea
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    placeholder={selectedAgentId ? `에이전트에게 보낼 요청 메시지를 입력하세요...` : '댓글을 입력하세요...'}
                    rows={3}
                    className="flex-1 text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                  <button
                    onClick={() => commentMutation.mutate({ content: commentText, agentId: selectedAgentId || undefined })}
                    disabled={!commentText.trim() || commentMutation.isPending}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 self-end"
                  >
                    {commentMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
