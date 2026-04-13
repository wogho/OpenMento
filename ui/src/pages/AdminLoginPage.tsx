/**
 * 관리자 / 강사 전용 로그인 페이지
 * POST /api/auth/login (admin_users 테이블)
 */

import { useForm } from 'react-hook-form';
import { useNavigate, Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { AuthUser } from '../hooks/useAuth';
import { ModeToggle } from '../components/mode-toggle';
import { useEffect, useState } from 'react';

interface LoginForm {
  email: string;
  password: string;
}

function getRedirectPath(user: AuthUser | null): string {
  if (!user) return '/admin';
  if (user.role === 'admin' || user.role === 'teacher') return '/admin';
  return '/chat';
}

export default function AdminLoginPage() {
  const { login, isLoading, user } = useAuth();
  const navigate = useNavigate();
  const [pendingRedirect, setPendingRedirect] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<LoginForm>();

  // login() 후 React 컨텍스트가 새 user로 커밋되면 리다이렉트
  // (atob 수동 디코딩 제거 — race condition 방지)
  useEffect(() => {
    if (pendingRedirect && user) {
      setPendingRedirect(false);
      navigate(getRedirectPath(user), { replace: true });
    }
  }, [pendingRedirect, user, navigate]);

  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password);
      setPendingRedirect(true);
    } catch (err) {
      setError('root', {
        message: err instanceof Error ? err.message : '로그인에 실패했습니다.',
      });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center px-4 relative">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl overflow-hidden shadow-xl mb-4">
            <img src="/icon-512.png" alt="OpenMento" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">OpenMento</h1>
          <p className="text-sm text-blue-300 mt-1">관리자 · 강사 포털</p>
        </div>

        {/* 카드 */}
          <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur rounded-2xl shadow-2xl px-7 py-8">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">관리자 로그인</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">기관 관리자 또는 강사 계정으로 접속하세요.</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* 이메일 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="email">
                이메일
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${errors.email ? 'border-red-400' : 'border-gray-200 dark:border-slate-600'}`}
                placeholder="admin@example.com"
                {...register('email', {
                  required: '이메일을 입력해 주세요.',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: '올바른 이메일 형식이 아닙니다.' },
                })}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="password">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${errors.password ? 'border-red-400' : 'border-gray-200 dark:border-slate-600'}`}
                placeholder="비밀번호 입력"
                {...register('password', {
                  required: '비밀번호를 입력해 주세요.',
                  minLength: { value: 6, message: '6자 이상 입력해 주세요.' },
                })}
              />
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
            </div>

            {/* 서버 에러 */}
            {errors.root && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2.5">
                <p className="text-sm text-red-600 dark:text-red-400">{errors.root.message}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 text-sm transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mt-1"
            >
              {isLoading ? '로그인 중...' : '관리자 로그인'}
            </button>
          </form>
        </div>

        {/* 수강생 로그인 전환 버튼 */}
        <div className="mt-5 text-center">
          <p className="text-sm text-blue-200/70 mb-2">수강생이신가요?</p>
          <Link
            to="/login/student"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl border border-white/20 transition"
          >
            <GraduationCap size={16} />
            수강생 로그인으로 이동
          </Link>
        </div>
      </div>
    </div>
  );
}
