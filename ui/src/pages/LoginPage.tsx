/**
 * 로그인 페이지 (수강생 / 강사 공용)
 *
 * - 이메일 + 비밀번호 폼 (react-hook-form)
 * - 제출 시 POST /api/auth/login → JWT 수신 → 채팅 페이지 이동
 * - 모바일 반응형 (320px~)
 */

import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password);
      navigate('/chat', { replace: true });
    } catch (err) {
      setError('root', {
        message: err instanceof Error ? err.message : '로그인에 실패했습니다.',
      });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--chat-bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* 로고 영역 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-blue-600 shadow-md mb-3">
            <img src="/icons/icon-192.png" alt="OpenMento" className="w-11 h-11 rounded-lg" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">OpenMento</h1>
          <p className="text-sm text-gray-500 mt-1">AI 기반 소크라테스식 튜터</p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white rounded-2xl shadow-lg px-6 py-7">
          <h2 className="text-lg font-semibold text-gray-800 mb-5">로그인</h2>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* 이메일 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                이메일
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={`
                  w-full rounded-xl border px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  transition
                  ${errors.email ? 'border-red-400' : 'border-gray-300'}
                `}
                placeholder="student@example.com"
                {...register('email', {
                  required: '이메일을 입력해 주세요.',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: '올바른 이메일 형식이 아닙니다.' },
                })}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className={`
                  w-full rounded-xl border px-3 py-2.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                  transition
                  ${errors.password ? 'border-red-400' : 'border-gray-300'}
                `}
                placeholder="비밀번호 입력"
                {...register('password', {
                  required: '비밀번호를 입력해 주세요.',
                  minLength: { value: 6, message: '6자 이상 입력해 주세요.' },
                })}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>
              )}
            </div>

            {/* 서버 에러 */}
            {errors.root && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                <p className="text-sm text-red-600">{errors.root.message}</p>
              </div>
            )}

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={isLoading}
              className="
                w-full bg-blue-600 hover:bg-blue-700
                text-white font-semibold rounded-xl py-3 text-sm
                transition active:scale-[0.98]
                disabled:opacity-60 disabled:cursor-not-allowed
                mt-2
              "
            >
              {isLoading ? '로그인 중...' : '로그인'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          계정 문의는 담당 강사에게 연락해 주세요.
        </p>
      </div>
    </div>
  );
}
