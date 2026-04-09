/**
 * 관리자 허브 (Phase 3-4 기준 좌측 사이드바 + 탭 구조)
 * - 원장 대시보드 (PrincipalDashboard)
 * - 강사 대시보드 (InstructorDashboard)
 * - 교재 관리 (DocumentManager)
 * - EWS 대시보드 (EwsDashboard)
 * - 스킬 파일 관리 (SkillManager)     ← Phase 3-4 신규
 * - 에이전트 설정 (AgentConfigurator) ← Phase 3-4 신규
 * - 스케줄 설정 (ScheduleSettings)
 * - EWS 임계치 (ThresholdSettings)
 * - 알림 채널 (NotificationSettings)
 * - 보안 키 관리 (SecretsManager)
 */

import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
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

// md-editor(~1MB)는 해당 탭 진입 시점에만 로드
const SkillManager      = lazy(() => import('./admin/SkillManager'));
const AgentConfigurator = lazy(() => import('./admin/AgentConfigurator'));
const PortfolioSettings = lazy(() => import('./admin/PortfolioSettings'));
const SystemMonitor     = lazy(() => import('./admin/SystemMonitor'));

type AdminTab =
  | 'principal'
  | 'instructor'
  | 'documents'
  | 'ews'
  | 'skills'
  | 'agents'
  | 'schedule'
  | 'thresholds'
  | 'notifications'
  | 'budget'
  | 'secrets'
  | 'portfolio-settings'
  | 'system';

export default function AdminPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('principal');

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const tabs: { id: AdminTab; label: string; icon: string; group?: string }[] = [
    { id: 'principal',     label: '원장 대시보드',   icon: '🏫', group: '대시보드' },
    { id: 'instructor',    label: '강사 대시보드',   icon: '👨‍🏫', group: '대시보드' },
    { id: 'ews',           label: 'EWS 대시보드',   icon: '🚨', group: '대시보드' },
    { id: 'documents',     label: '교재 관리',       icon: '📚', group: '콘텐츠' },
    { id: 'skills',        label: '스킬 파일 관리',  icon: '🧠', group: '콘텐츠' },
    { id: 'agents',        label: '에이전트 설정',   icon: '🤖', group: '콘텐츠' },
    { id: 'schedule',      label: '스케줄 설정',     icon: '📅', group: '설정' },
    { id: 'thresholds',    label: 'EWS 임계치',      icon: '🎚️', group: '설정' },
    { id: 'notifications', label: '알림 채널',       icon: '🔔', group: '설정' },
    { id: 'budget',        label: '예산 관리',       icon: '💰', group: '설정' },
    { id: 'secrets',            label: '보안 키 관리',       icon: '🔑', group: '설정' },
    { id: 'portfolio-settings', label: '포트폴리오 설정',    icon: '📋', group: '설정' },
    { id: 'system',             label: '시스템 모니터링',    icon: '📊', group: '시스템' },
  ];

  return (
    <div className="flex h-screen w-full bg-[#f8f9fa] overflow-hidden">
      {/* ── 좌측 사이드바 ── */}
      <aside className="w-[80px] md:w-[240px] shrink-0 border-r border-gray-200 bg-white flex flex-col transition-all">
        {/* 브랜딩 */}
        <div className="h-16 flex items-center justify-center md:justify-start md:px-5 shrink-0 border-b border-gray-100">
          <span className="text-2xl" role="img" aria-label="Logo">⚙️</span>
          <span className="hidden md:inline-block ml-2 font-bold text-gray-800 tracking-tight">Admin Hub</span>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`admin-sidebar-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`
                w-full flex items-center justify-center md:justify-start gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
              `}
              title={tab.label}
            >
              <span className="text-lg">{tab.icon}</span>
              <span className="hidden md:inline-block">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* 하단 사용자 정보 영역 */}
        <div className="shrink-0 p-3 md:p-4 border-t border-gray-200">
          <button
            id="admin-chat-preview-btn"
            onClick={() => navigate('/chat')}
            className="w-full flex items-center justify-center md:justify-start gap-2 p-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition mb-2"
            title="튜터 채팅 이동"
          >
            <span>🤖</span>
            <span className="hidden md:inline-block font-medium">수강생 라이동</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center md:justify-start gap-2 p-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition"
            title={`${user?.name ?? 'Admin'} · 로그아웃`}
          >
            <span>🚪</span>
            <span className="hidden md:inline-block font-medium">단기 로그아웃</span>
          </button>
        </div>
      </aside>

      {/* ── 우측 메인 콘텐츠 ── */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          {/* 타이틀 영역 */}
          <header className="mb-6 md:mb-8">
            <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h1>
            <p className="text-gray-500 text-sm mt-2">
              {activeTab === 'principal'     ? '기관 전체 KPI · 위험 수강생 현황' :
               activeTab === 'instructor'    ? '강사별 수강생 현황 · EWS 허위 양성 처리' :
               activeTab === 'documents'     ? 'RAG 파이프라인 연동 교재' :
               activeTab === 'ews'           ? 'EWS 위험 감지 · 자동 상담 예약 · 멘탈케어 메시지' :
               activeTab === 'skills'        ? 'AI 강사 스킬 파일 작성 · 저장 즉시 프롬프트 반영' :
               activeTab === 'agents'        ? '에이전트 등록 · 모델 선택 · 예산 · 스킬 파일 연결' :
               activeTab === 'schedule'      ? '루틴 스케줄 활성화 및 크론 표현식 관리' :
               activeTab === 'thresholds'    ? 'EWS 점수 가중치 · 위험 판정 기준 조정' :
               activeTab === 'notifications' ? 'Slack Webhook URL · 에스컬레이션 정책' :
               activeTab === 'budget'              ? 'LLM 토큰 비용 추적 · 월 예산 한도 · Soft Alert 설정' :
               activeTab === 'portfolio-settings' ? '유사도 임계값 · AI 피드백 스타일 · 비교 대상 범위 구성' :               activeTab === 'system'             ? 'API·DB·Redis·스케줄러 상태 · 에이전트 실행 이력 · 서비스 재시작' :               '외부 연동 API 암호화 센터'}
            </p>
          </header>

          {/* 콘텐츠 영역 렌더링 */}
          <div className="animate-fade-in">
            <Suspense fallback={<div className="flex justify-center py-20 text-gray-400 text-sm">로딩 중…</div>}>
              {activeTab === 'principal'     && <PrincipalDashboard />}
              {activeTab === 'instructor'    && <InstructorDashboard />}
              {activeTab === 'documents'     && <DocumentManager />}
              {activeTab === 'ews'           && <EwsDashboard />}
              {activeTab === 'skills'        && <SkillManager />}
              {activeTab === 'agents'        && <AgentConfigurator />}
              {activeTab === 'schedule'      && <ScheduleSettings />}
              {activeTab === 'thresholds'    && <ThresholdSettings />}
              {activeTab === 'notifications' && <NotificationSettings />}
              {activeTab === 'budget'             && <BudgetManagement />}
              {activeTab === 'secrets'            && <SecretsManager />}
              {activeTab === 'portfolio-settings' && <PortfolioSettings />}
              {activeTab === 'system'             && <SystemMonitor />}
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}