import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import SetupGuard from './components/SetupGuard';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import PortfolioPage from './pages/PortfolioPage';
import OnboardingTour from './components/OnboardingTour';
import { Toaster } from './components/ui/sonner';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <OnboardingTour />
        <Toaster position="top-right" richColors />
        <Routes>
          {/* 루트 → 채팅 페이지로 리다이렉트 */}
          <Route path="/" element={<Navigate to="/chat" replace />} />

          {/* 초기 설치 마법사 (플랫폼 미초기화 시 자동 리다이렉트) */}
          <Route path="/setup" element={<SetupPage />} />

          {/* 공개 라우트 (설치 완료 여부 확인 후 접근) */}
          <Route path="/login" element={<SetupGuard><LoginPage /></SetupGuard>} />

          {/* 보호된 라우트 (수강생 튜터) */}
          <Route
            path="/chat"
            element={
              <SetupGuard>
                <ProtectedRoute>
                  <ChatPage />
                </ProtectedRoute>
              </SetupGuard>
            }
          />

          {/* 보호된 라우트 (포트폴리오 기획서) */}
          <Route
            path="/portfolio"
            element={
              <SetupGuard>
                <ProtectedRoute>
                  <PortfolioPage />
                </ProtectedRoute>
              </SetupGuard>
            }
          />

          {/* 보호된 라우트 (관리자 허브) — admin role 전용 */}
          <Route
            path="/admin/*"
            element={
              <SetupGuard>
                <AdminRoute>
                  <AdminPage />
                </AdminRoute>
              </SetupGuard>
            }
          />

          {/* 404 처리 */}
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
