/**
 * 알림 채널 설정 — Slack Webhook URL 관리 + 에스컬레이션 테스트
 *
 * 기존 GET/PUT /admin/secrets 에 slackWebhookUrl 포함되어 있으므로
 * 해당 API 재사용 (SecretsManager와 같은 엔드포인트).
 * POST /admin/ews/slack-test — Slack 연결 테스트 (기존 API 재사용)
 *
 * 이 페이지에서는 Slack에 집중한 UI 제공:
 *  - Slack Webhook URL 입력 + 저장
 *  - 테스트 메시지 전송
 *  - 설정 가이드 링크
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface SecretsResponse {
  openaiApiKey: string;
  anthropicApiKey: string;
  slackWebhookUrl: string;
}

export default function NotificationSettings() {
  const { token } = useAuth();
  const [slackUrl, setSlackUrl] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: secrets, isLoading } = useQuery<SecretsResponse>({
    queryKey: ['admin-secrets'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/secrets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('설정 조회 실패');
      return res.json() as Promise<SecretsResponse>;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (secrets?.slackWebhookUrl) {
      setSlackUrl(secrets.slackWebhookUrl);
    }
  }, [secrets]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/secrets`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slackWebhookUrl: slackUrl }),
      });
      if (!res.ok) throw new Error('저장 실패');
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/ews/slack-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Slack 전송 실패');
      return res.json();
    },
    onSuccess: () => setTestResult({ ok: true, msg: 'Slack 테스트 메시지가 전송되었습니다.' }),
    onError: (e) => setTestResult({ ok: false, msg: (e as Error).message }),
  });

  const isValidUrl = slackUrl === '' || slackUrl.startsWith('https://hooks.slack.com/');

  return (
    <div className="space-y-6">
      {/* Slack 설정 */}
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
        <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2">
          💬 Slack 알림 채널
        </h2>

        {isLoading ? (
          <div className="text-sm text-gray-400 animate-pulse">로딩 중…</div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 block">
                Slack Incoming Webhook URL
              </label>
              <input
                type="url"
                value={slackUrl}
                onChange={(e) => { setSlackUrl(e.target.value); setTestResult(null); }}
                placeholder="https://hooks.slack.com/services/T.../B.../..."
                className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                  isValidUrl ? 'border-gray-200 focus:ring-blue-300' : 'border-red-300 focus:ring-red-300'
                }`}
              />
              {!isValidUrl && (
                <p className="text-xs text-red-500">올바른 Slack Webhook URL을 입력해주세요.</p>
              )}
              <p className="text-xs text-gray-400">
                Slack App → Incoming Webhooks에서 URL을 복사하세요.{' '}
                <a
                  href="https://api.slack.com/messaging/webhooks"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  Slack 가이드
                </a>
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !isValidUrl}
                className="bg-blue-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? '저장 중…' : 'URL 저장'}
              </button>

              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || !slackUrl}
                className="border border-gray-300 text-gray-700 px-5 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {testMutation.isPending ? '전송 중…' : '테스트 메시지 전송'}
              </button>
            </div>

            {saveMutation.isSuccess && (
              <p className="text-sm text-green-600">✅ URL이 저장되었습니다.</p>
            )}
            {saveMutation.isError && (
              <p className="text-sm text-red-500">저장 중 오류가 발생했습니다.</p>
            )}
            {testResult && (
              <div
                className={`rounded-xl px-4 py-3 text-sm ${
                  testResult.ok
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {testResult.ok ? '✅' : '❌'} {testResult.msg}
              </div>
            )}
          </>
        )}
      </div>

      {/* 에스컬레이션 정책 안내 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
        <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
          📣 에스컬레이션 정책
        </h3>
        <ul className="text-xs text-amber-700 space-y-1.5 list-disc ml-4">
          <li>EWS 점수가 설정된 <strong>Slack 에스컬레이션 기준</strong> 이상이면 즉시 알림 전송</li>
          <li>EWS 임계치 탭에서 에스컬레이션 기준 점수를 조정할 수 있습니다</li>
          <li>Slack URL이 미설정이면 알림이 무시됩니다 (슬랙 연동 필수)</li>
          <li>Rate Limit: 동일 수강생에 대해 24시간 내 중복 알림 방지</li>
        </ul>
      </div>

      {/* 향후 알림 채널 확장 안내 */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-medium text-gray-600 mb-2">📌 향후 지원 예정</h3>
        <div className="flex flex-wrap gap-2">
          {['이메일 알림 (Phase 3)', 'SMS 알림 (Phase 4)', 'LMS 연동 (Phase 5)'].map((item) => (
            <span key={item} className="text-xs bg-gray-100 text-gray-500 px-3 py-1. rounded-lg">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
