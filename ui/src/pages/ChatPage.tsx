/**
 * 수강생 AI 튜터 채팅 페이지 (Phase 1-4 핵심)
 *
 * 레이아웃:
 *   ┌──────────────────┐
 *   │  헤더 (과목명, 메뉴) │
 *   ├──────────────────┤
 *   │  연결 상태 배너    │  ← 재연결 중일 때만 표시
 *   ├──────────────────┤
 *   │                  │
 *   │   메시지 목록     │  ← react-virtuoso 가상화
 *   │                  │
 *   ├──────────────────┤
 *   │  채팅 입력창      │
 *   └──────────────────┘
 *
 * 모바일 320px ~ 데스크톱 1920px 반응형
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ModeToggle } from '../components/mode-toggle';
import { useNavigate } from 'react-router-dom';
import { Menu, BookOpen, ArrowLeft, SlidersHorizontal, MessageCircle, Sparkles, CalendarCheck, CheckCircle, Swords } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useAuth } from '../hooks/useAuth';
import { useChat } from '../hooks/useChat';
import ChatBubble from '../components/ChatBubble';
import ChatErrorBoundary from '../components/ChatErrorBoundary';
import TypingIndicator from '../components/TypingIndicator';
import ChatInput from '../components/ChatInput';
import ChatSidebar from './ChatSidebar';
import { useChatStore } from '../store/chatStore';
import AssignmentBoardModal from '../components/AssignmentBoardModal';
import PortfolioModal from '../components/PortfolioModal';

// ── 연결 상태 배너 ────────────────────────────────────────────────────────────

function ConnectionBanner({ status }: { status: 'reconnecting' | 'disconnected' }) {
  const isReconnecting = status === 'reconnecting';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`
        shrink-0 flex items-center justify-center gap-2 py-2 text-xs font-medium
        transition-colors duration-300
        ${isReconnecting ? 'bg-yellow-400 text-yellow-900' : 'bg-red-500 text-white'}
      `}
    >
      {isReconnecting ? (
        <>
          <svg className="inline-block animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          AI 서버와 재연결 중...
        </>
      ) : (
        <>연결이 끊어졌습니다. 잠시 후 자동 재시도합니다.</>
      )}
    </div>
  );
}

// ── 빈 대화 안내 ──────────────────────────────────────────────────────────────

function EmptyState({ onExampleClick }: { onExampleClick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 text-center px-8 gap-3">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 shadow flex items-center justify-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
      </div>
      <p className="text-base font-semibold text-gray-700 dark:text-gray-200">무엇이 궁금한가요?</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
        교재 내용, 개념 설명, 코드 원리 등<br />
        궁금한 것을 자유롭게 물어보세요.
      </p>
      <div className="flex flex-wrap gap-2 justify-center mt-2">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onExampleClick(q)}
            className="text-xs bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-full px-3 py-1.5 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-slate-400 hover:text-gray-800 dark:hover:text-gray-100 transition shadow-sm"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 수강 목록 화면 (과목 미선택 시) ────────────────────────────────────────────

function CourseListScreen({
  onSelect,
}: {
  onSelect: (courseId: string, agentId: string, courseName: string, instructorName: string | null) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['studentCourses'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? '/api'}/student/courses`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) return { courses: [] as Array<{ id: string; name: string; subject: string; instructorName: string | null; agentId: string | null; isActive: boolean }> };
      return res.json() as Promise<{ courses: Array<{ id: string; name: string; subject: string; instructorName: string | null; agentId: string | null; isActive: boolean }> }>;
    },
  });

  const courses = data?.courses ?? [];

  return (
    <div className="flex flex-col items-center justify-start flex-1 px-6 pt-16 gap-4 max-w-lg mx-auto w-full">
      <BookOpen size={40} className="text-blue-500 mb-2" />
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">수강 목록</h2>
      <p className="text-sm text-gray-400 dark:text-slate-500 mb-4">수강 중인 과목을 선택하세요.</p>
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mt-8" />
      ) : courses.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-gray-400 dark:text-slate-500">등록된 수강 과목이 없습니다.</p>
          <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">강사에게 과목 등록을 요청하세요.</p>
        </div>
      ) : (
        <div className="w-full space-y-3">
          {courses.map((course) => (
            <button
              key={course.id}
              disabled={!course.agentId}
              onClick={() => course.agentId && onSelect(course.id, course.agentId, course.name, course.instructorName)}
              className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">
                {course.instructorName
                  ? `${course.instructorName} - ${course.name}`
                  : course.name}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                {course.subject}
                {!course.agentId && ' · 에이전트 미설정 (강사에게 문의)'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

interface CourseMenuAgent {
  id: string;
  name: string;
  role: string;
  isOnline: boolean;
  isActiveForStudent: boolean;
  heartbeatDisabled: boolean;
  heartbeatEnabled: boolean; // runtimeConfig.heartbeat?.enabled
}

interface CourseMenuResponse {
  course: { id: string; name: string; subject: string };
  instructor: { id: string | null; name: string | null };
  agents: CourseMenuAgent[];
  limits: { activeAgentCount: number; maxActiveAgents: number };
  assignments: Array<{ id: string; title: string; dueAt: string | null; createdAt: string; isPublished: boolean }>;
  latestCall: { id: string; accepted: boolean; readAt: string | null; createdAt: string } | null;
}

interface StudentInstructorCallItem {
  id: string;
  accepted: boolean;
  message: string;
  createdAt: string;
}

export default function ChatPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCourseMenuOpen, setIsCourseMenuOpen] = useState(false);
  const [isDebateMode, setIsDebateMode] = useState(false);
  const [debateModalState, setDebateModalState] = useState<'confirm' | 'no_agents' | 'no_heartbeat' | null>(null);
  const [instructorChatNotificationId, setInstructorChatNotificationId] = useState<string | null>(null);
  const [instructorChatDraft, setInstructorChatDraft] = useState('');
  const [boardAssignmentId, setBoardAssignmentId] = useState<string | null>(null);
  const [portfolioModalOpen, setPortfolioModalOpen] = useState(false);
  // 선택된 과목 정보 — null이면 수강 목록 화면 표시
  const [selectedCourse, setSelectedCourse] = useState<{
    courseId: string;
    agentId: string;
    courseName: string;
    instructorName: string | null;
  } | null>(null);

  const courseMenuQuery = useQuery<CourseMenuResponse>({
    queryKey: ['student-course-menu', selectedCourse?.courseId],
    enabled: Boolean(selectedCourse?.courseId),
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/student/courses/${selectedCourse?.courseId}/menu`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) throw new Error('메뉴 정보를 불러오지 못했습니다.');
      return res.json() as Promise<CourseMenuResponse>;
    },
    refetchInterval: 10_000,
  });

  const callsQuery = useQuery<{ calls: StudentInstructorCallItem[] }>({
    queryKey: ['student-instructor-calls', selectedCourse?.courseId],
    enabled: Boolean(selectedCourse?.courseId),
    queryFn: async () => {
      const url = new URL(`${API_BASE}/student/instructor-calls`, window.location.origin);
      if (selectedCourse?.courseId) url.searchParams.set('courseId', selectedCourse.courseId);
      const res = await fetch(url.pathname + url.search, {
        headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) throw new Error('강사 호출 상태를 불러오지 못했습니다.');
      return res.json() as Promise<{ calls: StudentInstructorCallItem[] }>;
    },
    refetchInterval: 5_000,
  });

  const instructorChatMessagesQuery = useQuery<{ accepted: boolean; messages: Array<{ id: string; senderRole: 'student' | 'instructor'; content: string; createdAt: string }> }>({
    queryKey: ['student-instructor-chat', instructorChatNotificationId],
    enabled: Boolean(instructorChatNotificationId),
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/student/instructor-chat/${instructorChatNotificationId}/messages`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) throw new Error('1:1 채팅 이력을 불러오지 못했습니다.');
      return res.json() as Promise<{ accepted: boolean; messages: Array<{ id: string; senderRole: 'student' | 'instructor'; content: string; createdAt: string }> }>;
    },
    refetchInterval: 3_000,
  });

  const callInstructorMutation = useMutation({
    mutationFn: async (courseId: string) => {
      const res = await fetch(`${API_BASE}/student/courses/${courseId}/instructor-call`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? '강사 호출 요청에 실패했습니다.');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['student-course-menu', selectedCourse?.courseId] });
      void queryClient.invalidateQueries({ queryKey: ['student-instructor-calls', selectedCourse?.courseId] });
    },
  });

  const toggleHeartbeatMutation = useMutation({
    mutationFn: async ({ courseId, agentId, heartbeatDisabled }: { courseId: string; agentId: string; heartbeatDisabled: boolean }) => {
      const res = await fetch(`${API_BASE}/student/courses/${courseId}/agents/${agentId}/heartbeat`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('openmento_token')}`,
        },
        body: JSON.stringify({ heartbeatDisabled }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? '자율 발화 설정 변경에 실패했습니다.');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['student-course-menu', selectedCourse?.courseId] });
    },
  });

  const toggleAgentMutation = useMutation({
    mutationFn: async ({ courseId, agentId, isActive }: { courseId: string; agentId: string; isActive: boolean }) => {
      const res = await fetch(`${API_BASE}/student/courses/${courseId}/agents/${agentId}/toggle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('openmento_token')}`,
        },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? '에이전트 설정 변경에 실패했습니다.');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['student-course-menu', selectedCourse?.courseId] });
      void queryClient.invalidateQueries({ queryKey: ['studentCourses'] });
    },
  });

  const sendInstructorChatMutation = useMutation({
    mutationFn: async ({ notificationId, content }: { notificationId: string; content: string }) => {
      const res = await fetch(`${API_BASE}/student/instructor-chat/${notificationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('openmento_token')}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? '메시지 전송에 실패했습니다.');
      }
      return res.json();
    },
    onSuccess: () => {
      setInstructorChatDraft('');
      void queryClient.invalidateQueries({ queryKey: ['student-instructor-chat', instructorChatNotificationId] });
    },
  });

  // ── 출석 세션 조회 (3초마다 폴링) ────────────────────────────────────────
  const activeSessionQuery = useQuery<{
    session: { id: string; weekNo: number; sessionNo: number; sessionDate: string } | null;
    alreadyChecked: boolean;
    myStatus: string | null;
  }>({
    queryKey: ['active-attendance-session', selectedCourse?.courseId],
    enabled: Boolean(selectedCourse?.courseId),
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/attendance/sessions/active?courseId=${selectedCourse!.courseId}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` } },
      );
      if (!res.ok) return { session: null, alreadyChecked: false, myStatus: null };
      return res.json();
    },
    refetchInterval: 3_000,
  });

  // ── 수강생 자가 체크 ──────────────────────────────────────────────────────
  const selfCheckMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`${API_BASE}/attendance/sessions/${sessionId}/self-check`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? '출석 처리에 실패했습니다.');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['active-attendance-session', selectedCourse?.courseId] });
    },
  });

  const { messages, isTyping, error, connectionStatus, sendMessage, clearSession, clearMessages } = useChat({
    agentId: selectedCourse?.agentId ?? '',
    courseId: selectedCourse?.courseId,
    debateMode: isDebateMode,
  });

  const deleteMessage = useChatStore((s) => s.deleteMessage);

  // 과목 선택 시 해당 과목의 저장된 메시지 로드 (수강생별 분리)
  useEffect(() => {
    if (selectedCourse?.courseId && user?.sub) {
      useChatStore.getState().loadCourse(user.sub, selectedCourse.courseId);
    }
  }, [selectedCourse?.courseId, user?.sub]);

  useEffect(() => {
    if (!selectedCourse || !courseMenuQuery.data) return;
    const firstActiveAgent = courseMenuQuery.data.agents.find((a) => a.isActiveForStudent && a.isOnline);
    if (!firstActiveAgent) return;
    if (firstActiveAgent.id !== selectedCourse.agentId) {
      setSelectedCourse((prev) => (prev ? { ...prev, agentId: firstActiveAgent.id } : prev));
    }
  }, [courseMenuQuery.data, selectedCourse]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleSelectCourse = (courseId: string, agentId: string, courseName: string, instructorName: string | null) => {
    clearSession();
    // 메시지는 loadCourse useEffect에서 불러옴 — clearMessages 호출 안 함
    setSelectedCourse({ courseId, agentId, courseName, instructorName });
  };

  const handleBackToCourseList = () => {
    clearSession();
    // 수강 목록으로 돌아갈 때는 메시지를 지우지 않음 (localStorage에 유지)
    useChatStore.setState({ messages: [], activeCourseId: null });
    setSelectedCourse(null);
    setIsCourseMenuOpen(false);
    setInstructorChatNotificationId(null);
    setInstructorChatDraft('');
    void queryClient.invalidateQueries({ queryKey: ['studentCourses'] });
  };

  // Virtuoso에 전달할 표시 메시지 목록 (스트리밍 시작 전 빈 슬롯 및 컨텐츠없는 비카드 제외)
  const visibleMessages = messages.filter((m) => m.content !== '' || m.role === 'assignment_card');
  const streamingAiId = isTyping
    ? [...messages].reverse().find((m) => m.role === 'assistant')?.id
    : undefined;
  const showTypingIndicator =
    isTyping && messages.some((m) => m.role === 'assistant' && m.content === '');

  const latestAcceptedCall = callsQuery.data?.calls.find((c) => c.accepted) ?? null;
  const latestPendingCall = callsQuery.data?.calls.find((c) => !c.accepted) ?? null;
  const activeAgentCount = courseMenuQuery.data?.limits.activeAgentCount ?? 0;
  const maxActiveAgents = courseMenuQuery.data?.limits.maxActiveAgents ?? 0;

  return (
    <div className="flex h-screen w-full bg-gradient-to-br from-blue-50/40 via-white to-blue-50/20 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 overflow-hidden">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <ChatSidebar
        onSelectCourse={handleSelectCourse}
        activeCourseId={selectedCourse?.courseId}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {selectedCourse && isCourseMenuOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          onClick={() => setIsCourseMenuOpen(false)}
        />
      )}

      {selectedCourse && (
        <aside
          className={`fixed right-0 top-0 h-full w-[340px] max-w-[92vw] z-50 border-l border-gray-200 dark:border-slate-700
            bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl transition-transform duration-300
            ${isCourseMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">과목 채팅 메뉴</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {selectedCourse.instructorName ? `${selectedCourse.instructorName} 강사` : '강사 정보 없음'}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* ── 출석 확인 ───────────────────────────────────────────────── */}
              {activeSessionQuery.data?.session && (
                <section className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <CalendarCheck size={13} className="text-green-600 dark:text-green-400" />
                    <p className="text-xs font-semibold text-gray-500">출석 확인</p>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 animate-pulse">
                      세션 진행 중
                    </span>
                  </div>
                  <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 px-3 py-2">
                    <p className="text-xs text-green-700 dark:text-green-300 font-medium">
                      {activeSessionQuery.data.session.weekNo}주차 {activeSessionQuery.data.session.sessionNo}회차
                    </p>
                    <p className="text-[11px] text-green-600 dark:text-green-400 mt-0.5">
                      {activeSessionQuery.data.session.sessionDate}
                    </p>
                  </div>
                  {activeSessionQuery.data.alreadyChecked ? (
                    <div className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-medium py-2">
                      <CheckCircle size={15} />
                      출석 완료 ({activeSessionQuery.data.myStatus === 'present' ? '출석'
                        : activeSessionQuery.data.myStatus === 'late' ? '지각'
                        : activeSessionQuery.data.myStatus === 'excused' ? '공결'
                        : '결석'})
                    </div>
                  ) : (
                    <button
                      onClick={() => selfCheckMutation.mutate(activeSessionQuery.data!.session!.id)}
                      disabled={selfCheckMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 disabled:opacity-50 transition-colors"
                    >
                      <CalendarCheck size={15} />
                      {selfCheckMutation.isPending ? '처리 중...' : '출석 확인하기'}
                    </button>
                  )}
                  {selfCheckMutation.isError && (
                    <p className="text-xs text-red-500">{selfCheckMutation.error?.message}</p>
                  )}
                </section>
              )}

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500">강사 호출</p>
                  {latestPendingCall && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 animate-pulse">요청 대기중</span>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!selectedCourse) return;
                    callInstructorMutation.mutate(selectedCourse.courseId);
                  }}
                  disabled={callInstructorMutation.isPending || Boolean(latestPendingCall)}
                  className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 disabled:opacity-50"
                >
                  {callInstructorMutation.isPending ? '호출 요청 중...' : '강사와 채팅하기'}
                </button>
                {latestAcceptedCall && (
                  <button
                    onClick={() => setInstructorChatNotificationId(latestAcceptedCall.id)}
                    className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 inline-flex items-center justify-center gap-1"
                  >
                    <MessageCircle size={14} />
                    강사 1:1 채팅 열기
                  </button>
                )}
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">과제 보기</p>
                <div className="space-y-2">
                  {(courseMenuQuery.data?.assignments ?? []).slice(0, 6).map((a) => (
                    <div key={a.id} className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 line-clamp-1">{a.title}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {a.dueAt ? `제출기한: ${new Date(a.dueAt).toLocaleString('ko-KR')}` : '제출기한 없음'}
                      </p>
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => {
                            setBoardAssignmentId(a.id);
                            setIsCourseMenuOpen(false);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200"
                        >
                          보기
                        </button>
                        <button
                          onClick={() => sendMessage(`과제 "${a.title}"의 핵심 요구사항을 분석해주고, 제출 전략을 단계별로 안내해줘.`)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-violet-100 text-violet-700 hover:bg-violet-200"
                        >
                          <Sparkles size={11} /> 분석
                        </button>
                      </div>
                    </div>
                  ))}
                  {!courseMenuQuery.isLoading && (courseMenuQuery.data?.assignments.length ?? 0) === 0 && (
                    <p className="text-xs text-gray-400">등록된 과제가 없습니다.</p>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold text-gray-500">에이전트 활성화 / 비활성화</p>
                <p className="text-[11px] text-gray-400">
                  사용 가능 임계치: {activeAgentCount} / {maxActiveAgents}
                </p>
                <div className="space-y-2">
                  {(courseMenuQuery.data?.agents ?? []).map((agent) => (
                    <div key={agent.id} className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 space-y-2">
                      <label className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{agent.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {agent.role} · {agent.isOnline ? '온라인' : '오프라인'}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={agent.isActiveForStudent}
                          disabled={toggleAgentMutation.isPending}
                          onChange={(e) => {
                            if (!selectedCourse) return;
                            toggleAgentMutation.mutate({
                              courseId: selectedCourse.courseId,
                              agentId: agent.id,
                              isActive: e.target.checked,
                            });
                          }}
                          className="h-4 w-4"
                        />
                      </label>
                      {/* 자율 발화 서브토글 — heartbeat가 활성화된 에이전트에만 표시 */}
                      {agent.heartbeatEnabled && (
                        <label className="flex items-center justify-between pl-2 border-t border-gray-100 dark:border-slate-700 pt-1.5">
                          <div>
                            <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">자율 발화 알림</p>
                            <p className="text-[10px] text-gray-400">에이전트가 먼저 메시지를 보냅니다</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={!agent.heartbeatDisabled}
                            disabled={!agent.isActiveForStudent || toggleHeartbeatMutation.isPending}
                            onChange={(e) => {
                              if (!selectedCourse) return;
                              toggleHeartbeatMutation.mutate({
                                courseId: selectedCourse.courseId,
                                agentId: agent.id,
                                heartbeatDisabled: !e.target.checked,
                              });
                            }}
                            className="h-4 w-4 accent-blue-500"
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* ── 대화 모두 지우기 ── */}
              <section className="pt-1 border-t border-gray-100 dark:border-slate-800">
                <button
                  onClick={() => {
                    if (!window.confirm('이 과목의 대화 기록을 모두 삭제하시겠습니까?')) return;
                    clearMessages();
                    setIsCourseMenuOpen(false);
                  }}
                  className="w-full rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm font-medium py-2 transition-colors"
                >
                  대화 모두 지우기
                </button>
              </section>
            </div>
          </div>
        </aside>
      )}

      <div className="flex-1 chat-layout relative flex flex-col">
        {/* ── 헤더 ── */}
        <header className="shrink-0 flex items-center justify-between px-4 py-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-gray-100/80 dark:border-slate-800/80 text-gray-900 dark:text-white">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800 rounded-lg transition-colors"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            {selectedCourse ? (
              <button
                onClick={handleBackToCourseList}
                className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 transition"
                title="수강 목록으로 돌아가기"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
                <img src="/icon-512.png" alt="OpenMento" className="w-full h-full object-cover" />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold leading-tight">
                {selectedCourse
                  ? (selectedCourse.instructorName
                    ? `${selectedCourse.instructorName} - ${selectedCourse.courseName}`
                    : selectedCourse.courseName)
                  : 'OpenMento'}
              </p>
              <p className="text-[11px] opacity-70 leading-tight">
                {selectedCourse
                  ? (selectedCourse.instructorName ? `${selectedCourse.instructorName} 강사` : '교재 기반 소크라테스식 답변')
                  : 'AI 튜터'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ModeToggle />
            {selectedCourse && (
              <button
                onClick={() => {
                  if (isDebateMode) {
                    setIsDebateMode(false);
                    return;
                  }
                  const agents = courseMenuQuery.data?.agents ?? [];
                  const totalAgents = agents.length;
                  const heartbeatAgents = agents.filter((a) => a.heartbeatEnabled).length;
                  if (totalAgents < 2) {
                    setDebateModalState('no_agents');
                  } else if (heartbeatAgents < 2) {
                    setDebateModalState('no_heartbeat');
                  } else {
                    setDebateModalState('confirm');
                  }
                }}
                title={isDebateMode ? '토론 모드 비활성화' : '토론 모드 활성화'}
                aria-label="토론 모드 토글"
                className={`transition ${
                  isDebateMode
                    ? 'text-violet-600 dark:text-violet-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white'
                }`}
              >
                <Swords size={18} />
              </button>
            )}
            {selectedCourse && (
              <button
                onClick={() => setIsCourseMenuOpen((v) => !v)}
                title="과목 채팅 메뉴"
                aria-label="과목 채팅 메뉴"
                className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition"
              >
                <SlidersHorizontal size={18} />
              </button>
            )}
            <button
              id="portfolio-nav-btn"
              onClick={() => setPortfolioModalOpen(true)}
              title="포트폴리오 작성·조회"
              aria-label="포트폴리오 모달 열기"
              className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button
              onClick={handleLogout}
              title={`${user?.name ?? user?.sub} · 로그아웃`}
              aria-label="로그아웃"
              className="text-[11px] text-gray-600 dark:text-gray-400 bg-gray-100/80 hover:bg-gray-200/80 dark:bg-white/10 dark:hover:bg-white/20 rounded-full px-2.5 py-1 transition"
            >
              {user?.name ?? '로그아웃'}
            </button>
          </div>
        </header>

        {/* ── 소켓 연결 상태 배너 ── */}
        {selectedCourse && connectionStatus !== 'connected' && (
          <ConnectionBanner status={connectionStatus} />
        )}

        {/* ── 출석 세션 활성 배너 ── */}
        {selectedCourse && activeSessionQuery.data?.session && !activeSessionQuery.data?.alreadyChecked && (
          <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-green-500 text-white text-sm">
            <span className="flex items-center gap-2">
              <CalendarCheck size={15} />
              <span>
                {activeSessionQuery.data.session.weekNo}주차 {activeSessionQuery.data.session.sessionNo}회차 출석 세션이 진행 중입니다.
              </span>
            </span>
            <button
              onClick={() => selfCheckMutation.mutate(activeSessionQuery.data!.session!.id)}
              disabled={selfCheckMutation.isPending}
              className="text-xs px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 font-semibold disabled:opacity-50 transition-colors"
            >
              {selfCheckMutation.isPending ? '처리 중...' : '출석 확인'}
            </button>
          </div>
        )}

        {/* ── 과목 미선택: 수강 목록 화면 ── */}
        {!selectedCourse ? (
          <CourseListScreen onSelect={handleSelectCourse} />
        ) : (
          <>
            {/* ── 메시지 목록 ── */}
            <main id="chat-messages" className="flex-1 overflow-hidden flex flex-col">
              {visibleMessages.length === 0 && !isTyping ? (
                <EmptyState onExampleClick={sendMessage} />
              ) : (
                <ChatErrorBoundary>
                  <Virtuoso
                    aria-label="채팅 메시지 목록"
                    style={{ flex: 1 }}
                    data={visibleMessages}
                    followOutput="smooth"
                    components={{
                      Header: () => <div className="h-4" />,
                      Footer: () =>
                        showTypingIndicator ? (
                          <div className="px-3 py-1"><TypingIndicator /></div>
                        ) : null,
                    }}
                    itemContent={(_, msg) => (
                      <ChatBubble
                        message={msg}
                        isStreaming={isTyping && msg.id === streamingAiId && msg.role === 'assistant'}
                        onViewAssignment={(assignmentId) => {
                          setBoardAssignmentId(assignmentId);
                          setIsCourseMenuOpen(false);
                        }}
                        onAnalyzeAssignment={(title) => {
                          sendMessage(`과제 "${title}"의 핵심 요구사항을 분석해주고, 제출 전략을 단계별로 안내해줘.`);
                        }}
                        onDelete={deleteMessage}
                        onResend={(content) => sendMessage(content)}
                      />
                    )}
                  />
                </ChatErrorBoundary>
              )}
              {error && (
                <div className="shrink-0 mx-3 mb-2">
                  <div role="alert" aria-live="assertive" className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">
                    {error}
                  </div>
                </div>
              )}
            </main>

            {/* ── 입력창 ── */}
            <footer id="chat-input" className="shrink-0">
              <ChatInput onSend={sendMessage} disabled={isTyping} />
            </footer>
          </>
        )}
      </div>

      {boardAssignmentId && (
        <AssignmentBoardModal
          assignmentId={boardAssignmentId}
          onClose={() => setBoardAssignmentId(null)}
          onAnalyze={(title) => {
            setBoardAssignmentId(null);
            sendMessage(`과제 "${title}"의 핵심 요구사항을 분석해주고, 제적 전략을 단계별로 안내해줘.`);
          }}
        />
      )}

      {portfolioModalOpen && (
        <PortfolioModal
          courseId={selectedCourse?.courseId ?? null}
          onClose={() => setPortfolioModalOpen(false)}
        />
      )}

      {instructorChatNotificationId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-xl mx-4 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">강사 1:1 채팅</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">요청 ID: {instructorChatNotificationId}</p>
              </div>
              <button
                onClick={() => {
                  setInstructorChatNotificationId(null);
                  setInstructorChatDraft('');
                }}
                className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
              >
                닫기
              </button>
            </div>

            <div className="h-[340px] overflow-y-auto px-4 py-3 space-y-2 bg-gray-50/70 dark:bg-black/20">
              {instructorChatMessagesQuery.isLoading && (
                <p className="text-xs text-gray-400">메시지 불러오는 중...</p>
              )}
              {instructorChatMessagesQuery.data?.accepted === false && (
                <p className="text-xs text-amber-600">강사가 아직 채팅 요청을 수락하지 않았습니다.</p>
              )}
              {(instructorChatMessagesQuery.data?.messages ?? []).map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                    m.senderRole === 'student'
                      ? 'ml-auto bg-blue-600 text-white'
                      : 'mr-auto bg-white dark:bg-slate-800 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-slate-700'
                  }`}
                >
                  <p>{m.content}</p>
                  <p className={`mt-1 text-[10px] ${m.senderRole === 'student' ? 'text-blue-100' : 'text-gray-400'}`}>
                    {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center gap-2">
              <input
                value={instructorChatDraft}
                onChange={(e) => setInstructorChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && instructorChatDraft.trim()) {
                    sendInstructorChatMutation.mutate({
                      notificationId: instructorChatNotificationId,
                      content: instructorChatDraft.trim(),
                    });
                  }
                }}
                placeholder="강사에게 메시지를 입력하세요"
                className="flex-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none"
              />
              <button
                onClick={() => {
                  if (!instructorChatDraft.trim()) return;
                  sendInstructorChatMutation.mutate({
                    notificationId: instructorChatNotificationId,
                    content: instructorChatDraft.trim(),
                  });
                }}
                disabled={!instructorChatDraft.trim() || sendInstructorChatMutation.isPending}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                전송
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 토론 모드 모달 ── */}
      {debateModalState && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            {debateModalState === 'confirm' ? (
              <>
                <div className="px-5 pt-5 pb-4 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                    <Swords size={24} className="text-violet-600 dark:text-violet-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI 토론 모드 활성화</p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                    앞으로 모든 질문에 대해서<br />
                    스스로 AI가 서로 대화합니다.
                  </p>
                </div>
                <div className="px-5 pb-5 flex gap-2">
                  <button
                    onClick={() => setDebateModalState(null)}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-slate-700 text-sm font-medium py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => { setIsDebateMode(true); setDebateModalState(null); }}
                    className="flex-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2 transition"
                  >
                    활성화
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="px-5 pt-5 pb-4 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                    <Swords size={24} className="text-gray-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">토론 모드를 사용할 수 없습니다</p>
                  <div className="w-full rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-left">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">관리자 문의 바랍니다.</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      (사유:{' '}
                      {debateModalState === 'no_agents'
                        ? '해당 채팅창에는 하나의 에이전트 밖에 없습니다.'
                        : '주기적 하트비트 실행이 활성화된 두 개 이상의 에이전트가 없습니다.'}
                      )
                    </p>
                  </div>
                </div>
                <div className="px-5 pb-5">
                  <button
                    onClick={() => setDebateModalState(null)}
                    className="w-full rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sm font-medium py-2 text-gray-700 dark:text-gray-300 transition"
                  >
                    확인
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EXAMPLE_QUESTIONS = [
  'Java의 인터페이스와 추상 클래스 차이는?',
  'Spring MVC 동작 흐름을 설명해 주세요',
  '이 코드에서 왜 NullPointerException이 날까요?',
];