/**
 * EWS 임계치 설정 — 가중치 슬라이더 + 위험 판정 기준 조정
 *
 * GET /admin/thresholds — 현재 임계치 조회
 * PUT /admin/thresholds — 임계치 변경 (가중치 합계 = 100 검증)
 *
 * 가중치 항목:
 *  - attendanceWeight: 출결 (0-100)
 *  - assignmentWeight: 과제 제출 (0-100)
 *  - commitWeight: GitHub 커밋 (0-100)
 *  세 항목 합계가 반드시 100이어야 저장 가능.
 *
 * 위험 기준:
 *  - riskThreshold: 위험 판정 최소 점수
 *  - criticalThreshold: 심각 판정 최소 점수
 *  - slackEscalateScore: Slack 에스컬레이션 트리거 점수
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface Thresholds {
  attendanceWeight: number;
  assignmentWeight: number;
  commitWeight: number;
  riskThreshold: number;
  criticalThreshold: number;
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
  // 개선②: 마우스 드롭 시 자동 저장 콜백
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
        <span className={`text-sm font-bold ${color}`}>{value}</span>
      </div>
      <input
        type="range"
        min={min ?? 0}
        max={max ?? 100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        // 마우스/터치 드롭 시 저장 트리거 (이동 중에는 로컬 상태만 변경)
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
      // 임계치 변경 → EWS 점수 기준 변경 → 대시보드 KPI 무효화
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });

  if (isLoading) {
    return <div className="text-center py-16 text-gray-400 text-sm animate-pulse">⏳ 로딩 중…</div>;
  }

  if (isError || !form) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-600 text-sm">
        임계치 정보를 불러오지 못했습니다.
      </div>
    );
  }

  const weightSum = form.attendanceWeight + form.assignmentWeight + form.commitWeight;
  const weightValid = weightSum === 100;

  // 개선②: 슬라이더 드롭(onMouseUp/onTouchEnd) 시 자동 저장
  const autoSave = () => {
    if (form && weightValid) mutation.mutate(form);
  };

  const update = (key: keyof Thresholds) => (v: number) =>
    setForm((prev) => prev ? { ...prev, [key]: v } : prev);

  return (
    <div className="space-y-6">
      {/* 가중치 섹션 */}
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2">
            ⚖️ EWS 점수 가중치
          </h2>
          <span
            className={`text-sm font-bold px-2 py-0.5 rounded-full ${
              weightValid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            합계 {weightSum} / 100
          </span>
        </div>

        <SliderRow
          label="📋 출결 가중치"
          value={form.attendanceWeight}
          onChange={update('attendanceWeight')}
          onCommit={autoSave}
          color="text-blue-600"
          hint="출결 점수가 EWS 총점에 반영되는 비중"
        />
        <SliderRow
          label="📝 과제 제출 가중치"
          value={form.assignmentWeight}
          onChange={update('assignmentWeight')}
          onCommit={autoSave}
          color="text-indigo-600"
          hint="과제 제출율이 EWS 총점에 반영되는 비중"
        />
        <SliderRow
          label="🔗 GitHub 커밋 가중치"
          value={form.commitWeight}
          onChange={update('commitWeight')}
          onCommit={autoSave}
          color="text-purple-600"
          hint="GitHub 커밋 활동이 EWS 총점에 반영되는 비중"
        />

        {!weightValid && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
            세 가중치의 합이 100이 되어야 저장할 수 있습니다. 현재: {weightSum}
          </p>
        )}
      </div>

      {/* 위험 기준 섹션 */}
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
        <h2 className="font-bold text-gray-800 text-sm flex items-center gap-2">
          🎚️ 위험 판정 기준
        </h2>

        <SliderRow
          label="⚠️ 위험 판정 기준 점수"
          value={form.riskThreshold}
          onChange={update('riskThreshold')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-yellow-600"
          hint={`이 점수 이상이면 '위험' 상태로 분류됩니다`}
        />
        <SliderRow
          label="🚨 심각 판정 기준 점수"
          value={form.criticalThreshold}
          onChange={update('criticalThreshold')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-red-600"
          hint={`이 점수 이상이면 '심각' 상태로 분류됩니다`}
        />
        <SliderRow
          label="📣 Slack 에스컬레이션 점수"
          value={form.slackEscalateScore}
          onChange={update('slackEscalateScore')}
          onCommit={autoSave}
          min={0}
          max={100}
          color="text-orange-600"
          hint="이 점수 이상이면 Slack에 즉시 알림을 전송합니다"
        />
      </div>

      {/* 저장 버튼 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => mutation.mutate(form)}
          disabled={!weightValid || mutation.isPending}
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
          <p className="text-sm text-green-600">✅ 저장 완료</p>
        )}
      </div>
    </div>
  );
}
