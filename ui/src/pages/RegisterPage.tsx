/**
 * 수강생 초대 링크를 통한 최초 회원가입 페이지
 * 접근 경로: /register?token=<anonymousId>
 *
 * 흐름:
 *  1. URL 쿼리 파라미터에서 token 추출
 *  2. GET /api/auth/register/info?token=... 로 기관명 조회
 *  3. 이메일·비밀번호·이름 입력 후 POST /api/auth/register
 *  4. 성공 시 JWT 저장 → /chat 리다이렉트
 *  5. 이미 가입된 토큰 → /login/student 안내
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Building2, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ModeToggle } from '../components/mode-toggle';

interface RegisterForm {
  email: string;
  password: string;
  confirmPassword: string;
  displayName: string;
}

interface TokenInfo {
  institutionName: string;
  institutionId: string;
  displayName: string | null;
}

type PageState = 'loading' | 'ready' | 'expired' | 'already_registered' | 'success' | 'error';

export default function RegisterPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  const [state, setState] = useState<PageState>('loading');
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    watch,
  } = useForm<RegisterForm>();

  // 1) 토큰 유효성 확인
  useEffect(() => {
    if (!token) {
      setState('expired');
      setErrorMsg('초대 링크가 올바르지 않습니다. 관리자에게 새 링크를 요청해 주세요.');
      return;
    }

    fetch(`/api/auth/register/info?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json() as { institutionName?: string; institutionId?: string; displayName?: string | null; error?: string };
        if (res.status === 409) {
          setState('already_registered');
          return;
        }
        if (!res.ok) {
          setState('expired');
          setErrorMsg(body.error ?? '유효하지 않은 초대 링크입니다.');
          return;
        }
        setTokenInfo({
          institutionName: body.institutionName ?? '알 수 없는 기관',
          institutionId: body.institutionId ?? '',
          displayName: body.displayName ?? null,
        });
        setState('ready');
      })
      .catch(() => {
        setState('error');
        setErrorMsg('서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      });
  }, [token]);

  // 2) 가입 제출
  const onSubmit = async (data: RegisterForm) => {
    if (data.password !== data.confirmPassword) {
      setError('confirmPassword', { message: '비밀번호가 일치하지 않습니다.' });
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          email: data.email,
          password: data.password,
          displayName: data.displayName || undefined,
        }),
      });
      const body = await res.json() as { token?: string; error?: string; details?: unknown };
      if (!res.ok || !body.token) {
        setError('root', { message: body.error ?? '회원가입에 실패했습니다.' });
        return;
      }
      loginWithToken(body.token);
      navigate('/chat', { replace: true });
    } catch {
      setError('root', { message: '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };

  // ── 렌더링 분기 ──────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'already_registered') {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white/95 dark:bg-slate-800/95 rounded-2xl shadow-2xl p-8 text-center space-y-4">
          <CheckCircle className="mx-auto text-emerald-500" size={48} />
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">이미 가입 완료된 링크입니다</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            이 초대 링크로 이미 계정이 생성되었습니다.
            <br />
            수강생 로그인 페이지에서 접속해 주세요.
          </p>
          <Link
            to="/login/student"
            className="block w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition"
          >
            수강생 로그인으로 이동
          </Link>
        </div>
      </div>
    );
  }

  if (state === 'expired' || state === 'error') {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white/95 dark:bg-slate-800/95 rounded-2xl shadow-2xl p-8 text-center space-y-4">
          <AlertCircle className="mx-auto text-red-400" size={48} />
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">링크를 사용할 수 없습니다</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{errorMsg}</p>
          <Link
            to="/login/student"
            className="block w-full py-2.5 rounded-xl bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 text-sm font-semibold transition"
          >
            로그인 페이지로 이동
          </Link>
        </div>
      </div>
    );
  }

  // state === 'ready'
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 flex items-center justify-center px-4 relative">
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
          <p className="text-sm text-emerald-300 mt-1">수강생 계정 만들기</p>
        </div>

        {/* 카드 */}
        <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur rounded-2xl shadow-2xl px-7 py-8">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-1">회원가입</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">초대받은 기관에 계정을 생성합니다.</p>

          {/* 기관 배지 */}
          {tokenInfo && (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-xl px-3 py-2.5 mb-5">
              <Building2 size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300 truncate">
                {tokenInfo.institutionName}
              </span>
              <span className="ml-auto text-xs text-emerald-500 dark:text-emerald-400 flex-shrink-0">자동 배정</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* 이름 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="displayName">
                이름 <span className="text-gray-400 font-normal">(선택)</span>
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                defaultValue={tokenInfo?.displayName ?? ''}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-600 px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition"
                placeholder="홍길동"
                {...register('displayName')}
              />
            </div>

            {/* 이메일 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="email">
                이메일 <span className="text-red-400">*</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={`w-full rounded-xl border px-3 py-2.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition ${errors.email ? 'border-red-400' : 'border-gray-200 dark:border-slate-600'}`}
                placeholder="student@example.com"
                {...register('email', {
                  required: '이메일을 입력해 주세요.',
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: '올바른 이메일 형식이 아닙니다.' },
                })}
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="password">
                비밀번호 <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={`w-full rounded-xl border px-3 py-2.5 pr-10 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition ${errors.password ? 'border-red-400' : 'border-gray-200 dark:border-slate-600'}`}
                  placeholder="8자 이상"
                  {...register('password', {
                    required: '비밀번호를 입력해 주세요.',
                    minLength: { value: 8, message: '비밀번호는 최소 8자 이상이어야 합니다.' },
                  })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
            </div>

            {/* 비밀번호 확인 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" htmlFor="confirmPassword">
                비밀번호 확인 <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  className={`w-full rounded-xl border px-3 py-2.5 pr-10 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition ${errors.confirmPassword ? 'border-red-400' : 'border-gray-200 dark:border-slate-600'}`}
                  placeholder="비밀번호 재입력"
                  {...register('confirmPassword', {
                    required: '비밀번호 확인을 입력해 주세요.',
                    validate: (v) => v === watch('password') || '비밀번호가 일치하지 않습니다.',
                  })}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword.message}</p>}
            </div>

            {/* 루트 에러 */}
            {errors.root && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-3 py-2.5">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-600 dark:text-red-400">{errors.root.message}</p>
              </div>
            )}

            {/* 제출 버튼 */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  계정 생성 중...
                </>
              ) : (
                '회원가입 완료'
              )}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-5">
            이미 계정이 있으신가요?{' '}
            <Link to="/login/student" className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium">
              수강생 로그인
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
