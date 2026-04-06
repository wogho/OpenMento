/**
 * 관리자 허브 (Phase 1-5 기준 좌측 사이드바 + 탭 구조)
 * - 교재 관리 (DocumentManager)
 * - 보안 키 관리 (SecretsManager)
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import DocumentManager from './admin/DocumentManager';
import SecretsManager from './admin/SecretsManager';
import EwsDashboard from './admin/EwsDashboard';

type AdminTab = 'documents' | 'secrets' | 'ews';

export default function AdminPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('documents');

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const tabs: { id: AdminTab; label: string; icon: string }[] = [
    { id: 'documents', label: '교재 관리', icon: '📚' },
    { id: 'secrets',   label: '보안 키 관리', icon: '🔑' },
    { id: 'ews',       label: 'EWS 대시보드', icon: '🚨' },
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
            onClick={() => navigate('/chat')}
            className="w-full flex items-center justify-center md:justify-start gap-2 p-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition mb-2"
            title="튜터 채팅 이동"
          >
            <span>🤖</span>
            <span className="hidden md:inline-block font-medium">수강생 뷰 이동</span>
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
              EduClip 중앙 관리자 페이지 —{' '}
              {activeTab === 'documents' ? 'RAG 파이프라인 연동 교재' :
               activeTab === 'secrets'   ? '외부 연동 API 암호화 센터' :
               'EWS 위험 감지 · 자동 상담 예약 · 멘탈케어 메시지 확인'}
            </p>
          </header>

          {/* 콘텐츠 영역 렌더링 */}
          <div className="animate-fade-in">
            {activeTab === 'documents' && <DocumentManager />}
            {activeTab === 'secrets'   && <SecretsManager />}
            {activeTab === 'ews'       && <EwsDashboard />}
          </div>
        </div>
      </main>
    </div>
  );
}