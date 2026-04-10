/**
 * 전역 인증 컨텍스트
 *
 * - JWT 토큰을 localStorage에 저장
 * - 로그인/로그아웃 상태를 앱 전역에 공유
 * - accessToken에서 payload를 디코딩하여 사용자 정보 제공
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface AuthUser {
  sub: string;          // userId
  institutionId: string;
  role: 'student' | 'instructor' | 'admin';
  name?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'openmento_token';

function decodeJwt(token: string): AuthUser | null {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return {
      sub: decoded.sub,
      institutionId: decoded.institutionId,
      role: decoded.role,
      name: decoded.name,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? decodeJwt(t) : null;
  });
  const [isLoading, setIsLoading] = useState(false);

  // 토큰 만료 여부 체크 (페이지 포커스 시 재검증)
  useEffect(() => {
    const checkExpiry = () => {
      if (!token) return;
      const decoded = decodeJwt(token);
      if (!decoded) {
        logout();
        return;
      }
      // exp 클레임이 존재하면 만료 여부 확인
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        logout();
      }
    };
    window.addEventListener('focus', checkExpiry);
    return () => window.removeEventListener('focus', checkExpiry);
  }, [token]);

  const login = async (email: string, password: string) => {    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? '로그인에 실패했습니다.');
      }

      const data = (await res.json()) as { token: string };
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(decodeJwt(data.token));
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithToken = (newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(decodeJwt(newToken));
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithToken, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
