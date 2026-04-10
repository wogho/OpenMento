import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import PortfolioPage from './pages/PortfolioPage';
import OnboardingTour from './components/OnboardingTour';
import { Toaster } from './components/ui/sonner';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* Phase 5-3: 역할별 온보딩 투어 (첫 로그인 시 자동 실행) */}
        <OnboardingTour />
        <Toaster position="top-right" richColors />
        <Routes>
          {/* 루트 → 채팅 페이지로 리다이렉트 */}
          <Route path="/" element={<Navigate to="/chat" replace />} />

          {/* 공개 라우트 */}
          <Route path="/login" element={<LoginPage />} />

          {/* 보호된 라우트 (수강생 튜터) */}
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* 보호된 라우트 (포트폴리오 기획서) */}
          <Route
            path="/portfolio"
            element={
              <ProtectedRoute>
                <PortfolioPage />
              </ProtectedRoute>
            }
          />

          {/* 보호된 라우트 (관리자 허브) — admin role 전용 */}
          <Route
            path="/admin/*"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />

          {/* 404 처리 */}
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
