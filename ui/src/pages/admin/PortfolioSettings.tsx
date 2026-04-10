/**
 * PortfolioSettings — 관리자용 포트폴리오 설정 페이지 (Phase 4-3)
 *
 * 제공 설정:
 *  - 유사도 경고/위험 임계값 슬라이더
 *  - 기본 AI 피드백 스타일 (직접 제안 / 소크라테스식)
 *  - 비교 대상 범위 (현 기수만 / 전체 수료생)
 *
 * PUT /admin/portfolio-settings 로 저장
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface PortfolioConfig {
  /** 위험(critical) 임계값: 이 이상이면 표절 의심 */
  criticalThreshold: number;
  /** 주의(warning) 임계값: 이 이상이면 경고 */
  warningThreshold: number;
  /** 기본 AI 피드백 스타일 */
  defaultFeedbackStyle: 'direct' | 'socratic';
  /** 비교 대상 범위 */
  compareScope: 'current_cohort' | 'all';
}

const DEFAULT_CONFIG: PortfolioConfig = {
  criticalThreshold: 85,
  warningThreshold: 60,
  defaultFeedbackStyle: 'direct',
  compareScope: 'all',
};

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export default function PortfolioSettings() {
  const { token } = useAuth();
  const [config, setConfig] = useState<PortfolioConfig>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; msg: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  // ── 설정 로드 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/portfolio-settings`, { headers: authHeaders() })
      .then(async (r) => {
        if (r.ok) return r.json() as Promise<PortfolioConfig>;
        // 404면 기본값 사용
        if (r.status === 404) return DEFAULT_CONFIG;
        throw new Error('설정을 불러오지 못했습니다.');
      })
      .then((data) => setConfig(data))
      .catch((e) => setFeedback({ type: 'error', msg: (e as Error).message }))
      .finally(() => setIsLoading(false));
  }, [token, authHeaders]);

  // ── 필드 업데이트 헬퍼 ───────────────────────────────────────────────────
  function update<K extends keyof PortfolioConfig>(key: K, value: PortfolioConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setFeedback(null);
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // 임계값 유효성 검증 (warning < critical)
    if (config.warningThreshold >= config.criticalThreshold) {
      setFeedback({ type: 'error', msg: '주의 임계값은 위험 임계값보다 낮아야 합니다.' });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const res = await fetch(`${API_BASE}/admin/portfolio-settings`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? '저장 실패');
      }
      setIsDirty(false);
      setFeedback({ type: 'ok', msg: ' 설정이 저장되었습니다.' });
    } catch (e) {
      setFeedback({ type: 'error', msg: (e as Error).message });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
        설정을 불러오는 중…
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-7">
      <div>
        <h2 className="text-lg font-bold text-gray-800"> 포트폴리오 설정</h2>
        <p className="mt-1 text-xs text-gray-500">
          유사도 검사 기준과 기본 AI 피드백 스타일을 구성합니다.
        </p>
      </div>

      {/* ── 유사도 임계값 ─────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700"> 유사도 임계값</h3>

        {/* 위험(Critical) 슬라이더 */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-red-600">위험 임계값 (표절 의심)</label>
            <span className="text-sm font-bold text-red-600">{config.criticalThreshold}%</span>
          </div>
          <input
            type="range"
            min={50}
            max={100}
            step={1}
            value={config.criticalThreshold}
            onChange={(e) => update('criticalThreshold', Number(e.target.value))}
            className="w-full accent-red-500"
          />
          <p className="text-xs text-gray-400">
            유사도가 이 값 이상이면 <strong>표절 의심</strong>으로 판정됩니다.
          </p>
        </div>

        {/* 주의(Warning) 슬라이더 */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-yellow-600">주의 임계값 (차별화 권고)</label>
            <span className="text-sm font-bold text-yellow-600">{config.warningThreshold}%</span>
          </div>
          <input
            type="range"
            min={20}
            max={Math.min(config.criticalThreshold - 5, 99)}
            step={1}
            value={config.warningThreshold}
            onChange={(e) => update('warningThreshold', Number(e.target.value))}
            className="w-full accent-yellow-400"
          />
          <p className="text-xs text-gray-400">
            유사도가 이 값 이상이면 <strong>차별화 권고</strong>로 판정됩니다.
          </p>
        </div>

        {/* 임계값 시각화 */}
        <div className="relative h-5 rounded-full overflow-hidden bg-gray-100">
          <div
            className="absolute h-full bg-green-400 transition-all"
            style={{ width: `${config.warningThreshold}%` }}
          />
          <div
            className="absolute h-full bg-yellow-400 transition-all"
            style={{ left: `${config.warningThreshold}%`, width: `${config.criticalThreshold - config.warningThreshold}%` }}
          />
          <div
            className="absolute h-full bg-red-400 transition-all"
            style={{ left: `${config.criticalThreshold}%`, right: 0 }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400">
          <span>0% — 독창성 확인</span>
          <span className="text-yellow-600">{config.warningThreshold}%</span>
          <span className="text-red-600">{config.criticalThreshold}%</span>
          <span>100%</span>
        </div>
      </section>

      {/* ── 피드백 스타일 ────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700"> 기본 AI 피드백 스타일</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              value: 'direct' as const,
              label: '직접 제안',
              icon: '',
              desc: 'AI가 구체적인 개선안을 바로 제시합니다.',
            },
            {
              value: 'socratic' as const,
              label: '소크라테스식',
              icon: '',
              desc: '질문을 통해 학생 스스로 차별화를 발견하게 합니다.',
            },
          ].map(({ value, label, icon, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => update('defaultFeedbackStyle', value)}
              className={`
                text-left p-4 rounded-xl border transition-all
                ${config.defaultFeedbackStyle === value
                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'}
              `}
            >
              <span className="text-2xl">{icon}</span>
              <p className="mt-1.5 text-sm font-semibold text-gray-800">{label}</p>
              <p className="mt-1 text-xs text-gray-400 leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── 비교 대상 범위 ────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3 shadow-sm">
        <h3 className="text-sm font-bold text-gray-700"> 비교 대상 범위</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              value: 'current_cohort' as const,
              label: '현 기수만',
              icon: '',
              desc: '같은 기수 수강생 프로젝트와만 비교합니다.',
            },
            {
              value: 'all' as const,
              label: '전체 수료생',
              icon: '️',
              desc: '역대 모든 수료생 포트폴리오와 비교합니다.',
            },
          ].map(({ value, label, icon, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => update('compareScope', value)}
              className={`
                text-left p-4 rounded-xl border transition-all
                ${config.compareScope === value
                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'}
              `}
            >
              <span className="text-2xl">{icon}</span>
              <p className="mt-1.5 text-sm font-semibold text-gray-800">{label}</p>
              <p className="mt-1 text-xs text-gray-400 leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── 저장 / 피드백 배너 ────────────────────────────────────────────── */}
      {feedback && (
        <div
          className={`
            flex items-start gap-2 rounded-xl p-3 text-sm
            ${feedback.type === 'ok'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'}
          `}
        >
          <span>{feedback.type === 'ok' ? '' : '️'}</span>
          <span>{feedback.msg}</span>
        </div>
      )}

      <button
        onClick={() => void handleSave()}
        disabled={!isDirty || isSaving}
        className="
          w-full py-3 rounded-xl text-sm font-semibold
          bg-indigo-600 text-white hover:bg-indigo-700
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors duration-150
        "
      >
        {isSaving ? '저장 중…' : ' 설정 저장'}
      </button>
    </div>
  );
}
