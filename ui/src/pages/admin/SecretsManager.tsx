/**
 * 관리자 - 보안 키(Secrets) 관리 폼
 * GET /admin/secrets  → 마스킹된 초기값 로드
 * PUT /admin/secrets  → 변경된 필드만 업데이트 (빈 값은 전송 제외)
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../hooks/useAuth';

interface SecretsFormData {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  slackWebhookUrl?: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export default function SecretsManager() {
  const { token } = useAuth();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, reset } = useForm<SecretsFormData>({
    defaultValues: {
      openaiApiKey: '',
      anthropicApiKey: '',
      slackWebhookUrl: '',
    },
  });

  // 마스킹된 초기값 서버에서 로드
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/secrets`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: SecretsFormData) => reset(data))
      .catch(() => {
        // 조회 실패 시 빈 폼으로 유지 (서버 미구현 시에도 정상 동작)
      });
  }, [token, reset]);

  const onSubmit = async (data: SecretsFormData) => {
    setErrorMsg(null);
    setIsSubmitting(true);
    // 빈 값(변경하지 않은 필드)은 payload에서 제외
    const payload: SecretsFormData = {};
    if (data.openaiApiKey?.trim()) payload.openaiApiKey = data.openaiApiKey.trim();
    if (data.anthropicApiKey?.trim()) payload.anthropicApiKey = data.anthropicApiKey.trim();
    if (data.slackWebhookUrl?.trim()) payload.slackWebhookUrl = data.slackWebhookUrl.trim();

    try {
      const r = await fetch(`${API_BASE}/admin/secrets`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(r.statusText);
      setSuccessMsg('보안 키가 성공적으로 안전 저장되었습니다.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setErrorMsg('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    if (confirm('모든 값을 원래 상태(서버 데이터)로 되돌리시겠습니까?')) {
      reset();
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            🔐 시스템 외부 연동 Key 저장소
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            환경 변수(`.env`)에 기재하지 않고 데이터베이스 내 암호화되어 안전하게 보관됩니다.
            AI 튜터와 EWS 알림 기능 작동을 위한 필수 세팅입니다.
          </p>
        </div>

        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2 text-sm font-medium">
            ✅ {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2 text-sm font-medium">
            ⚠️ {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* OpenAI */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="openaiApiKey">
              OpenAI API Key
              <span className="text-xs text-gray-400 font-normal ml-2">(예: GPT-4o, GPT-4o-mini 토큰 발급)</span>
            </label>
            <input
              id="openaiApiKey"
              type="password"
              placeholder="sk-..."
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-gray-50"
              {...register('openaiApiKey')}
            />
          </div>

          {/* Anthropic */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="anthropicApiKey">
              Anthropic API Key
              <span className="text-xs text-gray-400 font-normal ml-2">(예: Claude Haiku, Sonnet 등)</span>
            </label>
            <input
              id="anthropicApiKey"
              type="password"
              placeholder="sk-ant-..."
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-gray-50"
              {...register('anthropicApiKey')}
            />
          </div>

          <hr className="my-6 border-gray-200" />

          {/* Slack Webhook */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="slackWebhookUrl">
              Slack Webhook URL (선택)
              <span className="text-xs text-gray-400 font-normal ml-2">(EWS 도달, 예산 위험 알림 등을 수신)</span>
            </label>
            <input
              id="slackWebhookUrl"
              type="url"
              placeholder="https://hooks.slack.com/..."
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-gray-50"
              {...register('slackWebhookUrl')}
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={handleReset}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
            >
              초기화
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition shadow-sm"
            >
              {isSubmitting ? '저장 중…' : '저장하기'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}