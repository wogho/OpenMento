/**
 * 관리자 허브 — Apple HIG / macOS System Settings 스타일
 * - 상단 frosted-glass 툴바 (52px)
 * - 좌측 사이드바: 검색 + 컬러 아이콘 배지 + 카드형 그룹
 * - `bg-[#f2f2f7]` Apple 시스템 배경
 */

import { ModeToggle } from '../components/mode-toggle';
import { useState, useEffect, useRef, lazy, Suspense, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  LayoutDashboard, GraduationCap, AlertTriangle, BookOpen, Brain,
  Bot, Clock, SlidersHorizontal, Bell, Wallet, KeyRound, FileSliders,
  Activity, LogOut, Users, Search, Building2,
  ChevronRight, Network, MessageCircle, FolderOpen,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import DocumentManager from './admin/DocumentManager';
import SecretsManager from './admin/SecretsManager';
import EwsDashboard from './admin/EwsDashboard';
import PrincipalDashboard from './admin/PrincipalDashboard';
import InstructorDashboard from './admin/InstructorDashboard';
import ScheduleSettings from './admin/ScheduleSettings';
import ThresholdSettings from './admin/ThresholdSettings';
import NotificationSettings from './admin/NotificationSettings';
import BudgetManagement from './admin/BudgetManagement';

const SkillManager          = lazy(() => import('./admin/SkillManager'));
const AgentConfigurator     = lazy(() => import('./admin/AgentConfigurator'));
const PortfolioSettings     = lazy(() => import('./admin/PortfolioSettings'));
const SystemMonitor         = lazy(() => import('./admin/SystemMonitor'));
const StudentManagement     = lazy(() => import('./admin/StudentManagement'));
const InstructorManagement  = lazy(() => import('./admin/InstructorManagement'));
const InstitutionManagement = lazy(() => import('./admin/InstitutionManagement'));
const CourseManager = lazy(() => import('./admin/CourseManager'));
const OrgChartPage  = lazy(() => import('./admin/OrgChart'));
const PortfolioManagement = lazy(() => import('./admin/PortfolioManagement'));
type AdminTab =
  | 'principal' | 'instructor' | 'courses' | 'documents' | 'ews' | 'skills' | 'agents' | 'org'
  | 'schedule' | 'thresholds' | 'notifications' | 'budget' | 'secrets'
  | 'portfolio-settings' | 'portfolios' | 'system' | 'students' | 'instructors' | 'institutions';

/** Apple SF Symbols 스타일 컬러 아이콘 배지 */
function IconBadge({ icon, color }: { icon: ReactNode; color: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-[30px] h-[30px] rounded-[8px] shrink-0 text-white shadow-sm ${color}`}
    >
      {icon}
    </span>
  );
}

type NavItem = {
  id: AdminTab;
  label: string;
  icon: ReactNode;
  color: string;
  desc: string;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    title: '대시보드',
    items: [
      { id: 'principal',  label: '전체 대시보드', icon: <LayoutDashboard size={15} />, color: 'bg-blue-500',   desc: '학원 전체 현황' },
      { id: 'instructor', label: '강사 대시보드', icon: <GraduationCap   size={15} />, color: 'bg-indigo-500', desc: '강사 성과 분석' },
      { id: 'ews',        label: '출결 대시보드',  icon: <AlertTriangle   size={15} />, color: 'bg-orange-500', desc: '출결 및 수강생 현황' },
    ],
  },
  {
    title: '계정 관리',
    items: [
      { id: 'students',      label: '수강생 관리', icon: <Users         size={15} />, color: 'bg-teal-500',   desc: '학생 계정' },
      { id: 'instructors',   label: '강사 관리',   icon: <GraduationCap size={15} />, color: 'bg-cyan-500',   desc: '강사 계정' },
      { id: 'institutions',  label: '기관 관리',   icon: <Building2     size={15} />, color: 'bg-violet-500', desc: '기관 설정' },
    ],
  },
  {
    title: '콘텐츠',
    items: [
      { id: 'courses', label: '과정 관리',     icon: <BookOpen size={15} />, color: 'bg-indigo-600',  desc: '강단 및 과정' },
      { id: 'documents', label: '교재 관리',     icon: <BookOpen size={15} />, color: 'bg-green-500',  desc: '학습 자료' },
      { id: 'skills',    label: '스킬 파일',     icon: <Brain    size={15} />, color: 'bg-pink-500',   desc: 'AI 스킬셋' },
      { id: 'agents',    label: '에이전트 설정', icon: <Bot      size={15} />, color: 'bg-purple-500', desc: 'AI 에이전트' },
      { id: 'org',       label: '조직도',        icon: <Network  size={15} />, color: 'bg-blue-600',   desc: '에이전트 계층' },
      { id: 'portfolios', label: '포트폴리오 관리', icon: <FolderOpen size={15} />, color: 'bg-rose-500', desc: '수강생 포트폴리오' },
    ],
  },
  {
    title: '설정',
    items: [
      { id: 'schedule',           label: '스케줄 설정',    icon: <Clock             size={15} />, color: 'bg-amber-500', desc: '운영 시간표' },
      { id: 'thresholds',         label: 'EWS 임계치',     icon: <SlidersHorizontal size={15} />, color: 'bg-red-500',   desc: '경보 기준값' },
      { id: 'notifications',      label: '알림 채널',      icon: <Bell              size={15} />, color: 'bg-sky-500',   desc: '알림 설정' },
      { id: 'budget',             label: '예산 관리',      icon: <Wallet            size={15} />, color: 'bg-emerald-500', desc: 'AI 비용' },
      { id: 'secrets',            label: '보안 키 관리',   icon: <KeyRound          size={15} />, color: 'bg-gray-600',  desc: 'API 키 보관' },
      { id: 'portfolio-settings', label: '포트폴리오 설정',icon: <FileSliders       size={15} />, color: 'bg-lime-600',  desc: '학생 포트폴리오' },
    ],
  },
  {
    title: '시스템',
    items: [
      { id: 'system', label: '시스템 모니터링', icon: <Activity size={15} />, color: 'bg-slate-600', desc: '서버 현황' },
    ],
  },
];

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

interface InstructorNotificationItem {
  id: string;
  studentId: string;
  courseId: string;
  type: string;
  message: string;
  readAt: string | null;
  accepted: boolean;
  createdAt: string;
  studentName: string | null;
  studentAnonymousId: string | null;
  courseName: string | null;
}

interface InstructorNotificationResponse {
  notifications: InstructorNotificationItem[];
  unreadCount: number;
}

interface InstructorChatMessage {
  id: string;
  senderRole: 'instructor' | 'student';
  content: string;
  createdAt: string;
}

export default function AdminPage() {
  const { user, token, logout } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const notifSocketRef = useRef<Socket | null>(null);

  const pathSegment = location.pathname.replace(/^\/admin\/?/, '').split('/')[0] as AdminTab;
  const validTabs: AdminTab[] = NAV_GROUPS.flatMap(g => g.items.map(i => i.id));
  const initialTab: AdminTab = validTabs.includes(pathSegment) ? pathSegment : 'principal';

  const [activeTab, setActiveTab]     = useState<AdminTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [avatarOpen, setAvatarOpen]   = useState(false);
  const [bellOpen, setBellOpen]       = useState(false);
  const [chatNotificationId, setChatNotificationId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');

  const isInstructorContext = Boolean(token && (user?.role === 'teacher' || user?.role === 'admin'));

  const notificationsQuery = useQuery<InstructorNotificationResponse>({
    queryKey: ['instructor-notifications'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/instructor/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('강사 알림을 불러오지 못했습니다.');
      return res.json() as Promise<InstructorNotificationResponse>;
    },
    enabled: isInstructorContext,
    refetchInterval: 15_000,
  });

  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  const chatMessagesQuery = useQuery<{ messages: InstructorChatMessage[] }>({
    queryKey: ['instructor-chat-messages', chatNotificationId],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/instructor/chat/${chatNotificationId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('채팅 메시지를 불러오지 못했습니다.');
      return res.json() as Promise<{ messages: InstructorChatMessage[] }>;
    },
    enabled: Boolean(isInstructorContext && chatNotificationId),
    refetchInterval: 3_000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await fetch(`${API_BASE}/instructor/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('읽음 처리 실패');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instructor-notifications'] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await fetch(`${API_BASE}/instructor/notifications/${notificationId}/accept`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('수락 실패');
      return res.json() as Promise<{ ok: boolean; notificationId: string }>;
    },
    onSuccess: (_data, notificationId) => {
      queryClient.invalidateQueries({ queryKey: ['instructor-notifications'] });
      setChatNotificationId(notificationId);
    },
  });

  const sendInstructorMessageMutation = useMutation({
    mutationFn: async ({ notificationId, content }: { notificationId: string; content: string }) => {
      const res = await fetch(`${API_BASE}/instructor/chat/${notificationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error('메시지 전송 실패');
      return res.json();
    },
    onSuccess: () => {
      setChatDraft('');
      queryClient.invalidateQueries({ queryKey: ['instructor-chat-messages', chatNotificationId] });
    },
  });

  const openNotificationChat = (notificationId: string) => {
    const current = notificationsQuery.data?.notifications.find((n) => n.id === notificationId);
    if (current && !current.accepted) {
      acceptMutation.mutate(notificationId);
      return;
    }
    setChatNotificationId(notificationId);
  };

  useEffect(() => {
    if (!isInstructorContext || !token) {
      notifSocketRef.current?.disconnect();
      notifSocketRef.current = null;
      return;
    }

    const socket = ioClient('/', {
      auth: { token },
      transports: ['websocket'],
    });

    const onCall = () => {
      queryClient.invalidateQueries({ queryKey: ['instructor-notifications'] });
    };
    const onInstructorChat = (payload: { notificationId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['instructor-notifications'] });
      if (payload?.notificationId) {
        queryClient.invalidateQueries({ queryKey: ['instructor-chat-messages', payload.notificationId] });
      }
    };

    socket.on('instructor_call_requested', onCall);
    socket.on('instructor_chat_message', onInstructorChat);
    // 과제 제출, 기타 확장 알림
    socket.on('instructor_notification', onCall);
    notifSocketRef.current = socket;

    return () => {
      socket.off('instructor_call_requested', onCall);
      socket.off('instructor_chat_message', onInstructorChat);
      socket.off('instructor_notification', onCall);
      socket.disconnect();
      notifSocketRef.current = null;
    };
  }, [isInstructorContext, token, queryClient]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const filteredGroups: NavGroup[] = searchQuery.trim()
    ? NAV_GROUPS.map(g => ({
        ...g,
        items: g.items.filter(
          i =>
            i.label.includes(searchQuery) ||
            i.desc.includes(searchQuery) ||
            i.id.includes(searchQuery.toLowerCase()),
        ),
      })).filter(g => g.items.length > 0)
    : NAV_GROUPS;

  const activeItem = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === activeTab);

  return (
    <div className="flex flex-col h-screen w-full bg-[#f2f2f7] dark:bg-[#1c1c1e] overflow-hidden">

      {/* ── 상단 툴바 (52px, frosted glass) ── */}
      <header className="h-[52px] shrink-0 flex items-center justify-between px-4
        bg-white/75 dark:bg-[#2c2c2e]/75 backdrop-blur-2xl
        border-b border-black/[0.06] dark:border-white/[0.06] z-30">

        {/* 좌: 브랜드 + 현재 위치 */}
        <div className="flex items-center gap-2 text-sm">
          <div className="w-6 h-6 rounded-[6px] bg-blue-600 flex items-center justify-center shrink-0">
            <LayoutDashboard size={12} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900 dark:text-white">
            {user?.institutionName || 'OpenMento'}
          </span>
          {activeItem && (
            <>
              <ChevronRight size={13} className="text-gray-400" />
              <span className="text-gray-500 dark:text-gray-400">{activeItem.label}</span>
            </>
          )}
        </div>

        {/* 우: 다크모드 토글 + 아바타 */}
        <div className="flex items-center gap-2">
          <ModeToggle />

          {isInstructorContext && (
            <div className="relative">
              <button
                onClick={() => setBellOpen((v) => !v)}
                className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  unreadCount > 0
                    ? 'bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 hover:bg-amber-200 animate-bell-glow'
                    : 'bg-black/[0.05] dark:bg-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-black/[0.08] dark:hover:bg-white/[0.12]'
                }`}
                title="강사 호출 알림"
                aria-label="강사 호출 알림"
              >
                <Bell size={14} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setBellOpen(false)}
                  />
                  <div className="absolute right-0 top-10 z-50 w-[340px] max-h-[420px] overflow-hidden
                    bg-white/95 dark:bg-[#2c2c2e]/95 backdrop-blur-xl rounded-2xl shadow-xl
                    border border-black/[0.06] dark:border-white/[0.08] flex flex-col">
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">강사 알림</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">읽지 않음 {unreadCount}건</p>
                    </div>

                    <div className="overflow-y-auto">
                      {notificationsQuery.isLoading && (
                        <p className="px-4 py-6 text-xs text-gray-400">불러오는 중...</p>
                      )}
                      {!notificationsQuery.isLoading && (notificationsQuery.data?.notifications.length ?? 0) === 0 && (
                        <p className="px-4 py-6 text-xs text-gray-400">새로운 호출이 없습니다.</p>
                      )}

                      {notificationsQuery.data?.notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`px-4 py-3 border-b border-gray-100/70 dark:border-white/[0.05] ${
                            n.readAt
                              ? 'bg-transparent'
                              : 'bg-amber-50/80 dark:bg-amber-900/25 border-l-2 border-l-amber-400 dark:border-l-amber-500'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.readAt && (
                              <span className="mt-0.5 w-2 h-2 rounded-full bg-amber-500 animate-bell-glow shrink-0 inline-block" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                {n.studentName ?? n.studentAnonymousId ?? '수강생'}
                                <span className="text-gray-400 font-normal"> · {n.courseName ?? '과목 미상'}</span>
                              </p>
                              <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{n.message}</p>
                              <p className="text-[10px] text-gray-400 mt-1">
                                {new Date(n.createdAt).toLocaleString('ko-KR')}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                {!n.readAt && (
                                  <button
                                    onClick={() => markReadMutation.mutate(n.id)}
                                    className="text-[11px] px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-600 dark:text-gray-300"
                                  >
                                    읽음
                                  </button>
                                )}
                                {n.type === 'assignment_submitted' ? (
                                  <button
                                    onClick={() => { setActiveTab('courses'); setBellOpen(false); }}
                                    className="text-[11px] px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1"
                                  >
                                    과제 확인
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => openNotificationChat(n.id)}
                                    className="text-[11px] px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
                                  >
                                    <MessageCircle size={11} />
                                    {n.accepted ? '채팅 열기' : '수락 후 채팅'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 아바타 드롭다운 */}
          <div className="relative">
            <button
              onClick={() => setAvatarOpen(v => !v)}
              className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center
                text-white text-xs font-semibold hover:ring-2 hover:ring-blue-400
                transition-all focus:outline-none"
            >
              {user?.name?.charAt(0)?.toUpperCase() ?? 'A'}
            </button>

            {avatarOpen && (
              <>
                {/* 외부 클릭 닫기 오버레이 */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAvatarOpen(false)}
                />
                <div className="absolute right-0 top-10 z-50 w-48
                  bg-white/90 dark:bg-[#2c2c2e]/90 backdrop-blur-xl
                  rounded-2xl shadow-xl border border-black/[0.06] dark:border-white/[0.08]
                  overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {user?.name || '관리자'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {user?.role || ''}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500
                      hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut size={14} />
                    로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── 본문 (사이드바 + 콘텐츠) ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── 좌측 사이드바 (macOS System Settings) ── */}
        <aside className="w-[240px] shrink-0 flex flex-col
          bg-white/60 dark:bg-[#2c2c2e]/60 backdrop-blur-xl
          border-r border-black/[0.05] dark:border-white/[0.05] overflow-y-auto">

          {/* 검색 바 */}
          <div className="px-3 pt-3 pb-2 shrink-0">
            <label className="flex items-center gap-2
              bg-black/[0.05] dark:bg-white/[0.07] rounded-[10px] px-2.5 py-1.5">
              <Search size={13} className="text-gray-400 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="검색"
                className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-100
                  placeholder:text-gray-400 focus:outline-none min-w-0"
              />
            </label>
          </div>

          {/* 채팅 미리보기 (온보딩 투어 타깃: admin-chat-preview-btn) */}
          <div className="px-3 pt-2 pb-1 shrink-0">
            <button
              id="admin-chat-preview-btn"
              onClick={() => navigate('/chat')}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400
                bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/30
                border border-indigo-100 dark:border-indigo-800 rounded-xl transition-colors"
              title="수강생 AI 튜터 채팅 화면 미리보기"
            >
              <span className="text-xs">💬</span>
              수강생 화면으로
            </button>
          </div>

          {/* 그룹별 네비게이션 */}
          <nav className="flex-1 px-3 pb-4 space-y-4">
            {filteredGroups.map(group => (
              <div key={group.title}>
                <p className="px-1 mb-1 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {group.title}
                </p>

                {/* 카드형 그룹 */}
                <div className="bg-white/80 dark:bg-[#3a3a3c]/80 rounded-2xl overflow-hidden
                  shadow-[0_1px_3px_rgba(0,0,0,0.06)] divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  {group.items.map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        id={`admin-sidebar-${tab.id}`}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                          ${isActive
                            ? 'bg-blue-50 dark:bg-blue-900/30'
                            : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                          }`}
                      >
                        <IconBadge icon={tab.icon} color={tab.color} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium leading-tight truncate
                            ${isActive
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-gray-800 dark:text-gray-100'
                            }`}>
                            {tab.label}
                          </p>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                            {tab.desc}
                          </p>
                        </div>
                        {isActive && (
                          <ChevronRight size={12} className="text-blue-500 dark:text-blue-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* ── 콘텐츠 영역 ── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* 섹션 헤더 */}
          {activeItem && (
            <div className="shrink-0 px-8 py-4 flex items-center gap-3
              bg-[#f2f2f7]/80 dark:bg-[#1c1c1e]/80 backdrop-blur-xl
              border-b border-black/[0.04] dark:border-white/[0.04]">
              <IconBadge icon={activeItem.icon} color={activeItem.color} />
              <div>
                <h1 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                  {activeItem.label}
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{activeItem.desc}</p>
              </div>
            </div>
          )}

          {/* 탭 컨텐츠 */}
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <Suspense fallback={
              <div className="flex items-center justify-center h-40">
                <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              </div>
            }>
              {activeTab === 'principal'          && <PrincipalDashboard />}
              {activeTab === 'instructor'         && (
                <InstructorDashboard
                  onNavigateTo={(tab) => setActiveTab(tab as AdminTab)}
                  onOpenInstructorChat={openNotificationChat}
                />
              )}
              {activeTab === 'students'           && (
                <StudentManagement
                  onOpenChat={isInstructorContext ? openNotificationChat : undefined}
                  pendingCallsByStudentId={
                    isInstructorContext
                      ? Object.fromEntries(
                          (notificationsQuery.data?.notifications ?? [])
                            .filter((n) => !n.readAt || n.accepted)
                            .map((n) => [n.studentId, { notificationId: n.id, accepted: n.accepted }])
                        )
                      : {}
                  }
                />
              )}
              {activeTab === 'instructors'        && <InstructorManagement />}
              {activeTab === 'documents'          && <DocumentManager />}
              {activeTab === 'ews'                && <EwsDashboard />}
              {activeTab === 'skills'             && <SkillManager />}
              {activeTab === 'agents'             && <AgentConfigurator />}
              {activeTab === 'schedule'           && <ScheduleSettings />}
              {activeTab === 'thresholds'         && <ThresholdSettings />}
              {activeTab === 'notifications'      && <NotificationSettings />}
              {activeTab === 'budget'             && <BudgetManagement />}
              {activeTab === 'secrets'            && <SecretsManager />}
              {activeTab === 'portfolio-settings' && <PortfolioSettings />}
              {activeTab === 'portfolios'          && <PortfolioManagement />}
              {activeTab === 'system'             && <SystemMonitor />}
              {activeTab === 'institutions'       && <InstitutionManagement />}
                {activeTab === 'courses'            && <CourseManager />}
              {activeTab === 'org'                && <OrgChartPage />}
            </Suspense>
          </div>
        </main>
      </div>

      {chatNotificationId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-xl mx-4 bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.08] flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">강사 1:1 채팅</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">요청 ID: {chatNotificationId}</p>
              </div>
              <button
                onClick={() => {
                  setChatNotificationId(null);
                  setChatDraft('');
                }}
                className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
              >
                닫기
              </button>
            </div>

            <div className="h-[360px] overflow-y-auto px-4 py-3 space-y-2 bg-gray-50/60 dark:bg-black/10">
              {chatMessagesQuery.isLoading && (
                <p className="text-xs text-gray-400">메시지를 불러오는 중...</p>
              )}
              {(chatMessagesQuery.data?.messages ?? []).map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                    m.senderRole === 'instructor'
                      ? 'ml-auto bg-blue-600 text-white'
                      : 'mr-auto bg-white dark:bg-[#3a3a3c] text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-white/[0.08]'
                  }`}
                >
                  <p>{m.content}</p>
                  <p className={`mt-1 text-[10px] ${m.senderRole === 'instructor' ? 'text-blue-100' : 'text-gray-400'}`}>
                    {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 dark:border-white/[0.08] flex items-center gap-2">
              <input
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && chatDraft.trim()) {
                    sendInstructorMessageMutation.mutate({
                      notificationId: chatNotificationId,
                      content: chatDraft.trim(),
                    });
                  }
                }}
                placeholder="메시지를 입력하세요"
                className="flex-1 rounded-lg border border-gray-200 dark:border-white/[0.12] bg-white dark:bg-[#1f1f21] px-3 py-2 text-sm outline-none"
              />
              <button
                onClick={() => {
                  if (!chatDraft.trim()) return;
                  sendInstructorMessageMutation.mutate({
                    notificationId: chatNotificationId,
                    content: chatDraft.trim(),
                  });
                }}
                disabled={!chatDraft.trim() || sendInstructorMessageMutation.isPending}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              >
                전송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
