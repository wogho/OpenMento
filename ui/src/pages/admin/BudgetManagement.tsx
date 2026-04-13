/**
 * 예산 관리 페이지 (Phase 2-7 + 4종 개선)
 *
 * GET    /admin/budget                 — 이번 달 소비 현황
 * PUT    /admin/budget                 — 기관 전체 예산 정책 설정
 * GET    /admin/budget/cost-events     — 최근 비용 이벤트 목록
 * GET    /admin/budget/pricing         — 모델 단가 목록 (개선④)
 * PUT    /admin/budget/pricing         — 단가 upsert (개선④)
 * DELETE /admin/budget/pricing/:id     — 단가 비활성화 (개선④)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface BreakdownRow {
  agentId: string | null;
  model: string;
  provider: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
}

interface BudgetSummary {
  month: string;
  totalCostUsd: number;
  limitUsd: number | null;
  alertThresholdPct: number;
  onExceed: 'pause' | 'alert_only';
  usagePct: number | null;
  breakdown: BreakdownRow[];
}

interface CostEvent {
  id: string;
  agentId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  createdAt: string;
}

interface ModelPricingRow {
  id: string;
  provider: string;
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  isActive: boolean;
  updatedAt: string;
}

// ── 게이지 바 컴포넌트 ────────────────────────────────────────────────────────

function UsageGauge({
  spendUsd,
  limitUsd,
  alertPct,
}: {
  spendUsd: number;
  limitUsd: number;
  alertPct: number;
}) {
  const pct = Math.min((spendUsd / limitUsd) * 100, 100);
  const isOver = pct >= 100;
  const isWarn = pct >= alertPct;

  const barColor = isOver
    ? 'bg-red-500'
    : isWarn
    ? 'bg-yellow-400'
    : 'bg-blue-500';

  const textColor = isOver
    ? 'text-red-600'
    : isWarn
    ? 'text-yellow-600'
    : 'text-blue-600';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className={`font-bold ${textColor}`}>{pct.toFixed(1)}% 사용</span>
        <span className="text-gray-500">
          ${spendUsd.toFixed(4)} / ${limitUsd.toFixed(2)}
        </span>
      </div>
      <div className="relative h-4 w-full rounded-full bg-gray-200 overflow-hidden">
        {/* Soft Alert 임계치 마커 */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 opacity-60 z-10"
          style={{ left: `${alertPct}%` }}
          title={`${alertPct}% Soft Alert 임계치`}
        />
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-400">
        노란 선: {alertPct}% Soft Alert 임계치 (Slack 알림 발송 기준)
      </p>
    </div>
  );
}

// ── 예산 정책 설정 폼 ─────────────────────────────────────────────────────────

function BudgetSettingsForm({
  current,
  onSaved,
}: {
  current: BudgetSummary | undefined;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const qc = useQueryClient();

  const [limitUsd, setLimitUsd] = useState<number>(current?.limitUsd ?? 10);
  const [period, setPeriod] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [alertPct, setAlertPct] = useState<number>(current?.alertThresholdPct ?? 80);
  const [onExceed, setOnExceed] = useState<'pause' | 'alert_only'>(
    current?.onExceed ?? 'pause',
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/budget`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ limitUsd, period, alertThresholdPct: alertPct, onExceed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? '예산 저장 실패');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['adminBudget'] });
      onSaved();
    },
  });

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
      <h3 className="text-base font-bold text-gray-800"> 예산 설정</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 예산 한도 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            월 예산 한도 (USD)
          </label>
          <input
            type="number"
            min={0.01}
            step={0.5}
            value={limitUsd}
            onChange={(e) => setLimitUsd(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none"
          />
        </div>

        {/* 주기 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">예산 주기</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as typeof period)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 outline-none"
          >
            <option value="monthly">월별</option>
            <option value="weekly">주별</option>
            <option value="daily">일별</option>
          </select>
        </div>

        {/* Soft Alert 임계치 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Soft Alert 임계치 (%)
          </label>
          <div className="space-y-1">
            <input
              type="range"
              min={10}
              max={99}
              value={alertPct}
              onChange={(e) => setAlertPct(Number(e.target.value))}
              className="w-full accent-yellow-500"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>10%</span>
              <span className="font-bold text-yellow-600">{alertPct}%</span>
              <span>99%</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            이 비율 도달 시 Slack 경고 알림 자동 발송
          </p>
        </div>

        {/* 초과 시 동작 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            100% 초과 시 동작
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="onExceed"
                value="pause"
                checked={onExceed === 'pause'}
                onChange={() => setOnExceed('pause')}
                className="accent-blue-500"
              />
              <span>에이전트 자동 일시정지</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="onExceed"
                value="alert_only"
                checked={onExceed === 'alert_only'}
                onChange={() => setOnExceed('alert_only')}
                className="accent-blue-500"
              />
              <span>알림만 발송 (계속 허용)</span>
            </label>
          </div>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-red-500">오류: {(mutation.error as Error).message}</p>
      )}
      {mutation.isSuccess && (
        <p className="text-sm text-green-600"> 예산 정책이 저장되었습니다.</p>
      )}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || limitUsd <= 0}
        className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition"
      >
        {mutation.isPending ? '저장 중...' : '저장'}
      </button>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function BudgetManagement() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [editingPricing, setEditingPricing] = useState<Partial<ModelPricingRow> | null>(null);

  // 이번 달 소비 현황
  const { data: budget, isLoading } = useQuery<BudgetSummary>({
    queryKey: ['adminBudget'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/budget`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('예산 데이터 로드 실패');
      return res.json();
    },
    refetchInterval: 60_000,
  });

  // 최근 비용 이벤트
  const { data: eventsData } = useQuery<{ events: CostEvent[] }>({
    queryKey: ['adminCostEvents'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/budget/cost-events?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('비용 이벤트 로드 실패');
      return res.json();
    },
    refetchInterval: 60_000,
  });

  // 모델 단가 목록 (개선④)
  const { data: pricingData, refetch: refetchPricing } = useQuery<{ pricing: ModelPricingRow[] }>({
    queryKey: ['adminModelPricing'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/budget/pricing`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('단가 데이터 로드 실패');
      return res.json();
    },
    enabled: showPricing,
  });

  const savePricingMutation = useMutation({
    mutationFn: async (body: { provider: string; model: string; inputPer1k: number; outputPer1k: number; isActive: boolean }) => {
      const res = await fetch(`${API_BASE}/admin/budget/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('단가 저장 실패');
      return res.json();
    },
    onSuccess: () => {
      setEditingPricing(null);
      void refetchPricing();
    },
  });

  const deletePricingMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE}/admin/budget/pricing/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('단가 삭제 실패');
    },
    onSuccess: () => void refetchPricing(),
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p className="text-2xl">⏳</p>
        <p className="mt-2 text-sm">예산 데이터를 불러오는 중...</p>
      </div>
    );
  }

  const limitSet = budget?.limitUsd != null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900"> 예산 관리</h2>
          <p className="text-sm text-gray-500 mt-0.5">{budget?.month ?? '-'} LLM 사용량 현황</p>
        </div>
        <div className="flex gap-2">
        <button
          onClick={() => { setShowSettings((v) => !v); qc.invalidateQueries({ queryKey: ['adminBudget'] }); }}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
        >
          {showSettings ? '▲ 닫기' : '️ 예산 설정'}
        </button>
        <button
          onClick={() => setShowPricing((v) => !v)}
          className="px-4 py-2 text-sm font-semibold rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 transition"
        >
          {showPricing ? '▲ 닫기' : ' 모델 단가'}
        </button>
        </div>
      </div>

      {/* 예산 설정 폼 (토글) */}
      {showSettings && (
        <BudgetSettingsForm
          current={budget}
          onSaved={() => setShowSettings(false)}
        />
      )}

      {/* 개선④: 모델 단가 관리 섹션 */}
      {showPricing && (
        <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-gray-800"> 모델 단가 관리</h3>
            <button
              onClick={() => setEditingPricing({ provider: '', model: '', inputPer1k: 0, outputPer1k: 0, isActive: true })}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition"
            >
              + 단가 추가
            </button>
          </div>

          {/* 단가 편집 폼 */}
          {editingPricing && (
            <form
              className="bg-purple-50 rounded-xl p-4 space-y-3 border border-purple-200"
              onSubmit={(e) => {
                e.preventDefault();
                if (!editingPricing.provider || !editingPricing.model) return;
                savePricingMutation.mutate({
                  provider:    editingPricing.provider,
                  model:       editingPricing.model,
                  inputPer1k:  editingPricing.inputPer1k ?? 0,
                  outputPer1k: editingPricing.outputPer1k ?? 0,
                  isActive:    editingPricing.isActive ?? true,
                });
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">제공자</label>
                  <input
                    className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    placeholder="openai / anthropic"
                    value={editingPricing.provider ?? ''}
                    onChange={(e) => setEditingPricing((p) => ({ ...p, provider: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">모델명</label>
                  <input
                    className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    placeholder="gpt-4o-mini"
                    value={editingPricing.model ?? ''}
                    onChange={(e) => setEditingPricing((p) => ({ ...p, model: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">입력 단가 ($/1K)</label>
                  <input
                    type="number" step="0.0001" min="0"
                    className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    value={editingPricing.inputPer1k ?? 0}
                    onChange={(e) => setEditingPricing((p) => ({ ...p, inputPer1k: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">출력 단가 ($/1K)</label>
                  <input
                    type="number" step="0.0001" min="0"
                    className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                    value={editingPricing.outputPer1k ?? 0}
                    onChange={(e) => setEditingPricing((p) => ({ ...p, outputPer1k: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditingPricing(null)}
                  className="px-3 py-1.5 text-xs rounded-lg border hover:bg-gray-50">취소</button>
                <button type="submit"
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  disabled={savePricingMutation.isPending}
                >
                  {savePricingMutation.isPending ? '저장 중…' : '저장'}
                </button>
              </div>
            </form>
          )}

          {/* 단가 목록 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-2 text-left font-semibold">제공자</th>
                  <th className="py-2 text-left font-semibold">모델</th>
                  <th className="py-2 text-right font-semibold">입력 $/1K</th>
                  <th className="py-2 text-right font-semibold">출력 $/1K</th>
                  <th className="py-2 text-center font-semibold">상태</th>
                  <th className="py-2 text-right font-semibold">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(pricingData?.pricing ?? []).map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="py-2 font-medium">{p.provider}</td>
                    <td className="py-2 font-mono text-xs text-blue-700">{p.model}</td>
                    <td className="py-2 text-right text-gray-700">${p.inputPer1k.toFixed(6)}</td>
                    <td className="py-2 text-right text-gray-700">${p.outputPer1k.toFixed(6)}</td>
                    <td className="py-2 text-center">
                      {p.isActive
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">활성</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">비활성</span>}
                    </td>
                    <td className="py-2 text-right space-x-2">
                      <button
                        onClick={() => setEditingPricing(p)}
                        className="text-xs text-blue-600 hover:underline"
                      >수정</button>
                      {p.isActive && (
                        <button
                          onClick={() => { if (confirm(`${p.model} 단가를 비활성화할까요?`)) deletePricingMutation.mutate(p.id); }}
                          className="text-xs text-red-500 hover:underline"
                        >비활성화</button>
                      )}
                    </td>
                  </tr>
                ))}
                {(pricingData?.pricing ?? []).length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-sm">
                    등록된 단가가 없습니다. 내장 기본값이 사용됩니다.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">* DB에 없는 모델은 내장 기본 단가(GPT-4o 기준)를 사용합니다.</p>
        </div>
      )}

      {/* 전체 월 소비 카드 */}
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        <h3 className="text-base font-bold text-gray-800">이번 달 전체 소비</h3>

        <div className="text-3xl font-extrabold text-gray-900">
          ${(budget?.totalCostUsd ?? 0).toFixed(4)}
          <span className="text-base text-gray-400 font-normal ml-2">USD</span>
        </div>

        {limitSet ? (
          <UsageGauge
            spendUsd={budget!.totalCostUsd}
            limitUsd={budget!.limitUsd!}
            alertPct={budget!.alertThresholdPct}
          />
        ) : (
          <div className="text-sm text-gray-400 bg-gray-50 rounded-xl p-3">
            ℹ️ 예산 한도가 설정되지 않았습니다. 위 설정 버튼을 눌러 한도를 지정하세요.
          </div>
        )}
      </div>

      {/* 에이전트별 Breakdown */}
      {budget && budget.breakdown.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">에이전트 / 모델별 소비</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-left">
                  <th className="pb-2 font-medium">에이전트</th>
                  <th className="pb-2 font-medium">모델</th>
                  <th className="pb-2 font-medium text-right">호출</th>
                  <th className="pb-2 font-medium text-right">입력 토큰</th>
                  <th className="pb-2 font-medium text-right">출력 토큰</th>
                  <th className="pb-2 font-medium text-right">비용 (USD)</th>
                </tr>
              </thead>
              <tbody>
                {budget.breakdown.map((row, i) => {
                  const pctOfTotal =
                    budget.totalCostUsd > 0
                      ? ((row.totalCostUsd / budget.totalCostUsd) * 100).toFixed(1)
                      : '0';
                  return (
                    <tr key={i} className="border-b last:border-0 hover:bg-gray-50 transition">
                      <td className="py-2 text-gray-600">
                        {row.agentId ? row.agentId.slice(0, 8) + '…' : '공통'}
                      </td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-mono">
                          {row.provider}/{row.model}
                        </span>
                      </td>
                      <td className="py-2 text-right text-gray-600">{row.callCount.toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-600">
                        {row.totalInputTokens.toLocaleString()}
                      </td>
                      <td className="py-2 text-right text-gray-600">
                        {row.totalOutputTokens.toLocaleString()}
                      </td>
                      <td className="py-2 text-right">
                        <span className="font-semibold text-gray-900">
                          ${row.totalCostUsd.toFixed(4)}
                        </span>
                        <span className="text-gray-400 text-xs ml-1">({pctOfTotal}%)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 최근 비용 이벤트 */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="text-base font-bold text-gray-800 mb-4">최근 LLM 호출 이력</h3>
        {eventsData && eventsData.events.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-left">
                  <th className="pb-2 font-medium">시각</th>
                  <th className="pb-2 font-medium">모델</th>
                  <th className="pb-2 font-medium text-right">입력</th>
                  <th className="pb-2 font-medium text-right">출력</th>
                  <th className="pb-2 font-medium text-right">비용</th>
                </tr>
              </thead>
              <tbody>
                {eventsData.events.map((ev) => (
                  <tr key={ev.id} className="border-b last:border-0 hover:bg-gray-50 transition">
                    <td className="py-1.5 text-gray-400 text-xs">
                      {new Date(ev.createdAt).toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-1.5">
                      <span className="font-mono text-xs text-blue-700">
                        {ev.provider}/{ev.model}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-gray-600">
                      {ev.promptTokens.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-gray-600">
                      {ev.completionTokens.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right font-semibold text-gray-900">
                      ${ev.costUsd.toFixed(6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">
            아직 LLM 호출 기록이 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
