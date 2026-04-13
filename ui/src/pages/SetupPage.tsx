/**
 * SetupPage — 플랫폼 초기 설치 마법사
 *
 * Step 1: 교육기관명 입력
 * Step 2: AI 에이전트 LLM 설정 (provider + API 키)
 * Step 3: 관리자 계정 (이름 + 이메일 + 비밀번호)
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuth } from '../hooks/useAuth';

interface SetupForm {
  institutionName: string;
  llmProvider: 'openai' | 'anthropic' | 'google';
  llmApiKey: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminPasswordConfirm: string;
}

const STEPS = ['교육기관 정보', 'AI 에이전트 설정', '관리자 계정'] as const;

export default function SetupPage() {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    formState: { errors },
  } = useForm<SetupForm>({ defaultValues: { llmProvider: 'openai' } });

  const watchPassword = watch('adminPassword');

  const nextStep = async () => {
    const fieldsPerStep: (keyof SetupForm)[][] = [
      ['institutionName'],
      ['llmProvider', 'llmApiKey'],
      ['adminName', 'adminEmail', 'adminPassword', 'adminPasswordConfirm'],
    ];
    const valid = await trigger(fieldsPerStep[step]);
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const onSubmit = async (data: SetupForm) => {
    setIsSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          institutionName: data.institutionName,
          adminName: data.adminName,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
          llmProvider: data.llmProvider,
          llmApiKey: data.llmApiKey || undefined,
        }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? '초기화에 실패했습니다.');
      }

      const { token } = (await res.json()) as { token: string };
      loginWithToken(token);
      navigate('/admin', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-blue-600 shadow mb-4">
            <img src="/icons/icon-192.png" alt="OpenMento" className="w-10 h-10 rounded-lg" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">OpenMento 초기 설정</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">플랫폼을 처음 사용하려면 아래 설정을 완료해 주세요.</p>
        </div>

        {/* 진행 상태 바 */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  i < step ? 'bg-blue-600 text-white' : i === step ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900' : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                }`}
              >
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-[11px] font-medium ${i === step ? 'text-blue-700 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500'}`}>{label}</span>
            </div>
          ))}
        </div>

        {/* 카드 */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 px-7 py-8">
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            {/* Step 0: 교육기관 정보 */}
            {step === 0 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">교육기관 정보를 입력해 주세요.</h2>
                <Field label="기관명" error={errors.institutionName?.message}>
                  <input
                    type="text"
                    placeholder="예: 한국 AI 아카데미"
                    className={inputClass(!!errors.institutionName)}
                    {...register('institutionName', { required: '기관명을 입력해 주세요.', minLength: { value: 2, message: '2자 이상 입력해 주세요.' } })}
                  />
                </Field>
              </div>
            )}

            {/* Step 1: AI 에이전트 설정 */}
            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">AI 에이전트에 사용할 LLM을 선택하세요.</h2>
                <Field label="LLM 제공사" error={errors.llmProvider?.message}>
                  <select className={inputClass(false)} {...register('llmProvider')}>
                    <option value="openai">OpenAI (GPT-4o)</option>
                    <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
                    <option value="google">Google (Gemini 1.5 Pro)</option>
                  </select>
                </Field>
                <Field label="API 키 (선택)" error={errors.llmApiKey?.message}>
                  <input
                    type="password"
                    placeholder="sk-... (나중에 비밀 관리자에서 변경 가능)"
                    className={inputClass(!!errors.llmApiKey)}
                    {...register('llmApiKey')}
                  />
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">지금 입력하지 않아도 관리자 페이지에서 나중에 설정할 수 있습니다.</p>
                </Field>
              </div>
            )}

            {/* Step 2: 관리자 계정 */}
            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">관리자 계정을 만들어 주세요.</h2>
                <Field label="이름" error={errors.adminName?.message}>
                  <input
                    type="text"
                    placeholder="홍길동"
                    className={inputClass(!!errors.adminName)}
                    {...register('adminName', { required: '이름을 입력해 주세요.', minLength: { value: 2, message: '2자 이상 입력해 주세요.' } })}
                  />
                </Field>
                <Field label="이메일" error={errors.adminEmail?.message}>
                  <input
                    type="email"
                    placeholder="admin@example.com"
                    autoComplete="email"
                    className={inputClass(!!errors.adminEmail)}
                    {...register('adminEmail', { required: '이메일을 입력해 주세요.', pattern: { value: /^\S+@\S+\.\S+$/, message: '올바른 이메일 형식이 아닙니다.' } })}
                  />
                </Field>
                <Field label="비밀번호" error={errors.adminPassword?.message}>
                  <input
                    type="password"
                    placeholder="8자 이상"
                    autoComplete="new-password"
                    className={inputClass(!!errors.adminPassword)}
                    {...register('adminPassword', { required: '비밀번호를 입력해 주세요.', minLength: { value: 8, message: '8자 이상 입력해 주세요.' } })}
                  />
                </Field>
                <Field label="비밀번호 확인" error={errors.adminPasswordConfirm?.message}>
                  <input
                    type="password"
                    placeholder="비밀번호 재입력"
                    autoComplete="new-password"
                    className={inputClass(!!errors.adminPasswordConfirm)}
                    {...register('adminPasswordConfirm', {
                      required: '비밀번호 확인을 입력해 주세요.',
                      validate: (v) => v === watchPassword || '비밀번호가 일치하지 않습니다.',
                    })}
                  />
                </Field>

                {serverError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                    <p className="text-sm text-red-600">{serverError}</p>
                  </div>
                )}
              </div>
            )}

            {/* 하단 버튼 */}
            <div className="flex justify-between mt-8">
              {step > 0 ? (
                <button
                  type="button"
                  className="px-4 py-2 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 transition"
                  onClick={() => setStep((s) => s - 1)}
                >
                  이전
                </button>
              ) : <div />}

              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={nextStep}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition"
                >
                  다음
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
                >
                  {isSubmitting ? '설정 중...' : '설정 완료'}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return `w-full rounded-lg border px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-700 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition ${
    hasError ? 'border-red-400' : 'border-gray-300 dark:border-slate-600'
  }`;
}
