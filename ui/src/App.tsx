import LandingPage from './pages/LandingPage';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import SetupGuard from './components/SetupGuard';
// LoginPage: /login/admin, /login/student 로 분리됨 (사용 안 함)
// import LoginPage from './pages/LoginPage';
import AdminLoginPage from './pages/AdminLoginPage';
import StudentLoginPage from './pages/StudentLoginPage';
import RegisterPage from './pages/RegisterPage';
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
          <Route path="/" element={<SetupGuard><LandingPage /></SetupGuard>} />

          {/* 초기 설치 마법사 (플랫폼 미초기화 시 자동 리다이렉트) */}
          <Route path="/setup" element={<SetupPage />} />

          {/* 공개 라우트 (설치 완료 여부 확인 후 접근) */}
          {/* /login → 관리자 로그인으로 리다이렉트 (하위 호환) */}
          <Route path="/login" element={<Navigate to="/login/admin" replace />} />
          <Route path="/login/admin" element={<SetupGuard><AdminLoginPage /></SetupGuard>} />
          <Route path="/login/student" element={<SetupGuard><StudentLoginPage /></SetupGuard>} />

          {/* 수강생 초대 링크 회원가입 (공개 라우트, SetupGuard 없이) */}
          <Route path="/register" element={<RegisterPage />} />

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
