/**
 * 관리자 - 보안 키(Secrets) 관리 폼
 * GET /admin/secrets  → 마스킹된 현재값 표시 (placeholder)
 * PUT /admin/secrets  → 변경된 필드만 업데이트 (빈 값·마스킹값은 전송 제외)
 *
 * [Bug Fix] GET 응답의 마스킹값(•••••1234)을 form input에 채우면
 * 저장 시 마스킹 문자가 실제 API 키로 저장되어 LLM 헤더 ByteString 오류 발생.
 * → 서버에서 받은 마스킹값은 placeholder로만 표시, input은 항상 빈값으로 시작.
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '../../hooks/useAuth';

interface SecretsFormData {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  openclawApiKey?: string;
  geminiApiKey?: string;
  ragOpenaiApiKey?: string;
  ragCohereApiKey?: string;
  ragGoogleApiKey?: string;
  ragEmbeddingDefaultProvider?: 'openai' | 'cohere' | 'google';
  slackWebhookUrl?: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

/** API 키 필드에 대해 마스킹 문자(•)가 포함된 값은 저장 대상에서 제외 */
function isValidApiKey(v: string | undefined): boolean {
  if (!v?.trim()) return false;
  return !v.includes('•');
}

export default function SecretsManager() {
  const { token } = useAuth();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** 서버에서 받은 마스킹값 — placeholder로만 사용 */
  const [maskedHints, setMaskedHints] = useState<SecretsFormData>({});

  const { register, handleSubmit, reset } = useForm<SecretsFormData>({
    defaultValues: {
      openaiApiKey: '',
      anthropicApiKey: '',
      openclawApiKey: '',
      geminiApiKey: '',
      ragOpenaiApiKey: '',
      ragCohereApiKey: '',
      ragGoogleApiKey: '',
      ragEmbeddingDefaultProvider: 'openai',
      slackWebhookUrl: '',
    },
  });

  // 마스킹된 현재값을 서버에서 로드하여 placeholder에만 표시
  // form 입력값에는 채우지 않음 — 마스킹 문자가 실제 키로 저장되는 버그 방지
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/secrets`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: SecretsFormData) => {
        // 마스킹값은 힌트용으로 저장, ragEmbeddingDefaultProvider는 선택값이므로 폼에 반영
        setMaskedHints(data);
        reset({
          openaiApiKey: '',
          anthropicApiKey: '',
          openclawApiKey: '',
          geminiApiKey: '',
          ragOpenaiApiKey: '',
          ragCohereApiKey: '',
          ragGoogleApiKey: '',
          ragEmbeddingDefaultProvider: data.ragEmbeddingDefaultProvider ?? 'openai',
          slackWebhookUrl: '',
        });
      })
      .catch(() => {
        // 조회 실패 시 빈 폼으로 유지
      });
  }, [token, reset]);

  const onSubmit = async (data: SecretsFormData) => {
    setErrorMsg(null);
    setIsSubmitting(true);
    // 빈 값 또는 마스킹 문자(•)가 포함된 값은 payload에서 제외
    const payload: SecretsFormData = {};
    if (isValidApiKey(data.openaiApiKey)) payload.openaiApiKey = data.openaiApiKey!.trim();
    if (isValidApiKey(data.anthropicApiKey)) payload.anthropicApiKey = data.anthropicApiKey!.trim();
    if (isValidApiKey(data.openclawApiKey)) payload.openclawApiKey = data.openclawApiKey!.trim();
    if (isValidApiKey(data.geminiApiKey)) payload.geminiApiKey = data.geminiApiKey!.trim();
    if (isValidApiKey(data.ragOpenaiApiKey)) payload.ragOpenaiApiKey = data.ragOpenaiApiKey!.trim();
    if (isValidApiKey(data.ragCohereApiKey)) payload.ragCohereApiKey = data.ragCohereApiKey!.trim();
    if (isValidApiKey(data.ragGoogleApiKey)) payload.ragGoogleApiKey = data.ragGoogleApiKey!.trim();
    if (data.ragEmbeddingDefaultProvider) {
      payload.ragEmbeddingDefaultProvider = data.ragEmbeddingDefaultProvider;
    }
    if (data.slackWebhookUrl?.trim() && !data.slackWebhookUrl.includes('•')) {
      payload.slackWebhookUrl = data.slackWebhookUrl.trim();
    }

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
             시스템 외부 연동 Key 저장소
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            환경 변수(`.env`)에 기재하지 않고 데이터베이스 내 암호화되어 안전하게 보관됩니다.
            AI 튜터와 EWS 알림 기능 작동을 위한 필수 세팅입니다.
          </p>
        </div>

        {successMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2 text-sm font-medium">
             {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2 text-sm font-medium">
            ️ {errorMsg}
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
              placeholder={maskedHints.openaiApiKey ? `현재 키 설정됨 (${maskedHints.openaiApiKey}) — 변경 시에만 입력` : 'sk-...'}
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
              placeholder={maskedHints.anthropicApiKey ? `현재 키 설정됨 (${maskedHints.anthropicApiKey}) — 변경 시에만 입력` : 'sk-ant-...'}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-gray-50"
              {...register('anthropicApiKey')}
            />
          </div>

          <hr className="my-6 border-gray-200" />

          {/* Google / Gemini */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="geminiApiKey">
              Google / Gemini API Key
              <span className="text-xs text-gray-400 font-normal ml-2">(Google AI Studio 발급 — Gemini 모델 사용 시 필요)</span>
            </label>
            <input
              id="geminiApiKey"
              type="password"
              placeholder={maskedHints.geminiApiKey ? `현재 키 설정됨 (${maskedHints.geminiApiKey}) — 변경 시에만 입력` : 'AIza...'}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-gray-50"
              {...register('geminiApiKey')}
            />
            <p className="text-xs text-gray-400">
              등록하면 <code>GEMINI_API_KEY</code> 및 <code>GOOGLE_API_KEY</code> 환경변수에 즉시 반영됩니다.
            </p>
          </div>

          {/* OpenClaw */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700" htmlFor="openclawApiKey">
              OpenClaw API Key
              <span className="text-xs text-gray-400 font-normal ml-2">(OpenClaw Gateway 인증용)</span>
            </label>
            <input
              id="openclawApiKey"
              type="password"
              placeholder={maskedHints.openclawApiKey ? `현재 키 설정됨 (${maskedHints.openclawApiKey}) — 변경 시에만 입력` : 'sk-...'}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-gray-50"
              {...register('openclawApiKey')}
            />
          </div>

          <hr className="my-6 border-gray-200" />

          {/* RAG Embedding 전용 키 */}
          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-blue-800">RAG 임베딩 전용 API 설정</h3>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700" htmlFor="ragEmbeddingDefaultProvider">
                기본 RAG 임베딩 프로바이더
              </label>
              <select
                id="ragEmbeddingDefaultProvider"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-white"
                {...register('ragEmbeddingDefaultProvider')}
              >
                <option value="openai">OpenAI</option>
                <option value="cohere">Cohere</option>
                <option value="google">Google</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700" htmlFor="ragOpenaiApiKey">
                RAG OpenAI API Key
              </label>
              <input
                id="ragOpenaiApiKey"
                type="password"
                placeholder={maskedHints.ragOpenaiApiKey ? `현재 키 설정됨 (${maskedHints.ragOpenaiApiKey}) — 변경 시에만 입력` : 'sk-...'}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-white"
                {...register('ragOpenaiApiKey')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700" htmlFor="ragCohereApiKey">
                RAG Cohere API Key
              </label>
              <input
                id="ragCohereApiKey"
                type="password"
                placeholder={maskedHints.ragCohereApiKey ? `현재 키 설정됨 (${maskedHints.ragCohereApiKey}) — 변경 시에만 입력` : 'co_...'}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-white"
                {...register('ragCohereApiKey')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-700" htmlFor="ragGoogleApiKey">
                RAG Google API Key
              </label>
              <input
                id="ragGoogleApiKey"
                type="password"
                placeholder={maskedHints.ragGoogleApiKey ? `현재 키 설정됨 (${maskedHints.ragGoogleApiKey}) — 변경 시에만 입력` : 'AIza...'}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 focus:bg-white bg-white"
                {...register('ragGoogleApiKey')}
              />
            </div>
          </div>

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