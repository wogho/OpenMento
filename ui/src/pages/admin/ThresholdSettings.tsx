/**
 * EWS 임계치 설정 — 위험 판정 기준 조정
 *
 * GET /admin/thresholds — 현재 임계치 조회
 * PUT /admin/thresholds — 임계치 변경
 *
 * EWS 점수 가중치 (고정값, 코드에서 관리):
 *  - AI 상호작용 (LMS 연동 시 40점 / 미연동 시 60점)
 *  - 출석률       (LMS 연동 시 20점 / 미연동 시 0점 — 재배분)
 *  - 과제 미제출  (25점)
 *  - 강사 상담    (15점)
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface Thresholds {
  warningThreshold:   number;
  highRiskThreshold:  number;
  criticalThreshold:  number;
  slackEscalateScore: number;
}

// ── 슬라이더 행 ───────────────────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  color,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  color: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className={`text-sm font-bold ${color}`}>{value}점</span>
      </div>
      <input
        type="range"
        min={min ?? 0}
        max={max ?? 100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        className="w-full accent-blue-500"
      />
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function ThresholdSettings() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Thresholds>({
    queryKey: ['admin-thresholds'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/thresholds`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('임계치 조회 실패');
      return res.json() as Promise<Thresholds>;
    },
    staleTime: 30_000,
  });

  const [form, setForm] = useState<Thresholds | null>(null);

  useEffect(() => {
    if (data) setForm({ ...data });
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (thresholds: Thresholds) => {
      const res = await fetch(`${API_BASE}/admin/thresholds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? '저장 실패');
      }
      return res.json() as Promise<Thresholds>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['admin-thresholds'], updated);
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });

  if (isLoading) {
    return <div className="text-center py-16 text-gray-400 text-sm animate-pulse">로딩 중…</div>;
  }

  if (isError || !form) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-600 text-sm">
        임계치 정보를 불러오지 못했습니다.
      </div>
    );
  }

  const autoSave = () => {
    if (form) mutation.mutate(form);
  };

  const update = (key: keyof Thresholds) => (v: number) =>
    setForm((prev) => prev ? { ...prev, [key]: v } : prev);

  return (
    <div className="space-y-6">
      {/* EWS 가중치 구조 안내 (읽기 전용) */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-3">
        <h2 className="font-bold text-blue-800 text-sm flex items-center gap-2">
          EWS 점수 가중치 구조
        </h2>
        <p className="text-xs text-blue-600 leading-relaxed">
          가중치는 LMS 연동 여부에 따라 자동으로 재배분됩니다.
          LMS 미연동 시 출석 가중치(20점)가 AI 상호작용 지표로 흡수됩니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'AI 상호작용', lms: '40점', noLms: '60점', color: 'bg-purple-100 text-purple-700' },
            { label: '과제 미제출',  lms: '25점', noLms: '25점', color: 'bg-indigo-100 text-indigo-700' },
            { label: '강사 상담',    lms: '15점', noLms: '15점', color: 'bg-teal-100 text-teal-700' },
            { label: '출석률',       lms: '20점', noLms: '0점',  color: 'bg-orange-100 text-orange-700' },
          ].map((w) => (
            <div key={w.label} className={`rounded-xl px-3 py-2 text-xs font-medium flex items-center justify-between ${w.color}`}>
              <span>{w.label}</span>
              <span>
                <span className="opacity-70">LMS연동</span> {w.lms}
                <span className="mx-1 opacity-40">|</span>
                <span className="opacity-70">미연동</span> {w.noLms}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 위험 기준 섹션 */}
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
        <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2">
          위험 판정 기준
        </h2>

        <SliderRow
          label="주의(Warning) 판정 기준"
          value={form.warningThreshold}
          onChange={update('warningThreshold')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-yellow-600"
          hint="이 점수 이상이면 '주의' 상태로 분류됩니다"
        />
        <SliderRow
          label="위험(High Risk) 판정 기준"
          value={form.highRiskThreshold}
          onChange={update('highRiskThreshold')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-orange-600"
          hint="이 점수 이상이면 '위험' 상태로 분류됩니다"
        />
        <SliderRow
          label="긴급(Critical) 판정 기준"
          value={form.criticalThreshold}
          onChange={update('criticalThreshold')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-red-600"
          hint="이 점수 이상이면 '긴급' 상태로 분류되며 자동 상담 예약이 생성됩니다"
        />
        <SliderRow
          label="Slack 에스컬레이션 점수"
          value={form.slackEscalateScore}
          onChange={update('slackEscalateScore')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-blue-600"
          hint="이 점수 이상이면 Slack에 즉시 알림을 전송합니다"
        />
      </div>

      {/* 저장 버튼 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
          className="bg-blue-500 text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? '저장 중…' : '변경 사항 저장'}
        </button>
        <button
          onClick={() => setForm(data ? { ...data } : null)}
          disabled={mutation.isPending}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
        >
          초기화
        </button>
        {mutation.isError && (
          <p className="text-sm text-red-500">{(mutation.error as Error).message}</p>
        )}
        {mutation.isSuccess && (
          <p className="text-sm text-green-600">저장 완료</p>
        )}
      </div>
    </div>
  );
}
