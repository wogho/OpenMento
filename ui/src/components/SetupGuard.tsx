/**
 * SetupGuard — 플랫폼 초기화 여부를 확인하고 미초기화 시 /setup으로 리다이렉트
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function SetupGuard({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((data: { needsSetup?: boolean }) => {
        if (data.needsSetup && location.pathname !== '/setup') {
          navigate('/setup', { replace: true });
        }
      })
      .catch(() => {/* 네트워크 오류 시 현재 페이지 유지 */})
      .finally(() => setChecked(true));
  }, [navigate, location.pathname]);

  if (!checked) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50">
        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
