/**
 * 관리자 전용 라우트 보호 컴포넌트
 * JWT role이 'admin'인 경우에만 접근 허용, 아닐 경우 /chat으로 리다이렉트
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { ReactNode } from 'react';

interface AdminRouteProps {
  children: ReactNode;
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/chat" replace />;
  }

  return <>{children}</>;
}
