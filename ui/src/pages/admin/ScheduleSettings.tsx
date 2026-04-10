/**
 * 스케줄 설정 — 루틴 활성화/비활성화 + 크론 표현식 시각적 편집
 *
 * GET /admin/routines      — 루틴 + 트리거 목록
 * PUT /admin/routines/:id  — 루틴 활성/비활성 + cronExpression 변경
 *
 * 크론 표현식: 5-field (minute hour day month weekday)
 *  - 직접 입력 대신 자주 쓰는 프리셋 버튼 제공
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface RoutineTrigger {
  id: string;
  kind: 'cron' | 'webhook' | 'manual';
  cronExpression: string | null;
  webhookEvent: string | null;
  isActive: boolean;
}

interface Routine {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  agentId: string;
  courseId: string | null;
  createdAt: string;
  updatedAt: string;
  triggers: RoutineTrigger[];
}

// ── 크론 프리셋 ───────────────────────────────────────────────────────────────

const CRON_PRESETS: { label: string; value: string; desc: string }[] = [
  { label: '매일 오전 9시',   value: '0 9 * * *',   desc: '평일 주중 포함 매일' },
  { label: '매일 오후 6시',   value: '0 18 * * *',  desc: '매일 저녁' },
  { label: '월·수·금 9시',   value: '0 9 * * 1,3,5', desc: '주 3회' },
  { label: '매주 월요일 9시', value: '0 9 * * 1',   desc: '주간 요약' },
  { label: '매주 금요일 5시', value: '0 17 * * 5',  desc: '주간 마무리' },
  { label: '매시간',          value: '0 * * * *',   desc: '시간별 체크' },
];

// ── 루틴 카드 ─────────────────────────────────────────────────────────────────

function RoutineCard({
  routine,
  token,
  onUpdated,
}: {
  routine: Routine;
  token: string;
  onUpdated: () => void;
}) {
  const cronTrigger = routine.triggers.find((t) => t.kind === 'cron');
  const webhookTrigger = routine.triggers.find((t) => t.kind === 'webhook');

  const [cronExpr, setCronExpr] = useState(cronTrigger?.cronExpression ?? '');
  const [editingCron, setEditingCron] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await fetch(`${API_BASE}/admin/routines/${routine.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error('루틴 상태 변경 실패');
    },
    onSuccess: onUpdated,
  });

  const cronMutation = useMutation({
    mutationFn: async (cronExpression: string) => {
      const res = await fetch(`${API_BASE}/admin/routines/${routine.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cronExpression }),
      });
      if (!res.ok) throw new Error('크론 표현식 변경 실패');
    },
    onSuccess: () => {
      onUpdated();
      setEditingCron(false);
    },
  });

  return (
    <div className={`border rounded-xl p-5 transition-all ${routine.isActive ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white'}`}>
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">{routine.isActive ? '' : ''}</span>
            <h3 className="font-semibold text-gray-800 text-sm">{routine.name}</h3>
          </div>
          {routine.description && (
            <p className="text-xs text-gray-500 mt-1 ml-5">{routine.description}</p>
          )}
        </div>

        {/* 토글 스위치 */}
        <button
          onClick={() => toggleMutation.mutate(!routine.isActive)}
          disabled={toggleMutation.isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 focus:outline-none ${
            routine.isActive ? 'bg-blue-500' : 'bg-gray-300'
          } disabled:opacity-50`}
          aria-label={routine.isActive ? '비활성화' : '활성화'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              routine.isActive ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* 트리거 정보 */}
      <div className="mt-3 ml-5 flex flex-wrap gap-2">
        {cronTrigger && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-lg font-mono">
            ⏱ {cronTrigger.cronExpression ?? '미설정'}
          </span>
        )}
        {webhookTrigger && (
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-lg">
             webhook: {webhookTrigger.webhookEvent ?? 'all'}
          </span>
        )}
      </div>

      {/* 크론 편집 (cron 트리거가 있을 때만) */}
      {cronTrigger && (
        <div className="mt-3 ml-5">
          {!editingCron ? (
            <button
              onClick={() => setEditingCron(true)}
              className="text-xs text-blue-500 hover:underline"
            >
              크론 표현식 변경
            </button>
          ) : (
            <div className="space-y-2">
              {/* 프리셋 버튼 */}
              <div className="flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setCronExpr(p.value)}
                    title={p.desc}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                      cronExpr === p.value
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* 직접 입력 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="0 9 * * 1"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  onClick={() => cronMutation.mutate(cronExpr)}
                  disabled={cronMutation.isPending || !cronExpr.trim()}
                  className="bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {cronMutation.isPending ? '저장 중…' : '저장'}
                </button>
                <button
                  onClick={() => { setEditingCron(false); setCronExpr(cronTrigger.cronExpression ?? ''); }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-2"
                >
                  취소
                </button>
              </div>
              {cronMutation.isError && (
                <p className="text-xs text-red-500">저장 중 오류가 발생했습니다.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function ScheduleSettings() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Routine[]>({
    queryKey: ['admin-routines'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/routines`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('루틴 목록 조회 실패');
      return res.json() as Promise<Routine[]>;
    },
    staleTime: 30_000,
  });

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-routines'] });
    // 루틴 활성/비활성 변경 → Heartbeat 실행 주기 변경 → 대시보드 KPI 무효화
    queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };

  if (isLoading) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm animate-pulse">⏳ 로딩 중…</div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-600 text-sm">
        루틴 목록을 불러오지 못했습니다.
      </div>
    );
  }

  const active = data?.filter((r) => r.isActive).length ?? 0;
  const total = data?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* 요약 배너 */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl px-5 py-3 flex items-center justify-between">
        <p className="text-sm text-purple-800 font-medium">
           루틴 스케줄 — 활성 <strong>{active}</strong> / 전체 <strong>{total}</strong>
        </p>
        <p className="text-xs text-purple-500">토글로 즉시 활성화/비활성화</p>
      </div>

      {total === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
          등록된 루틴이 없습니다. plan.md seed 또는 DB 마이그레이션을 먼저 실행하세요.
        </div>
      ) : (
        <div className="space-y-3">
          {data!.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              token={token ?? ''}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      )}

      {/* 크론 표현식 참고 */}
      <details className="mt-2">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
          크론 표현식 문법 참고
        </summary>
        <div className="mt-2 bg-gray-50 rounded-xl p-4 text-xs font-mono text-gray-600 space-y-1">
          <p>형식: <strong>분 시 일 월 요일</strong></p>
          <p>예시: <code>0 9 * * 1,3,5</code> = 월·수·금 오전 9시</p>
          <p>예시: <code>0 */6 * * *</code> = 6시간마다</p>
          <p>요일: 0=일 1=월 2=화 3=수 4=목 5=금 6=토</p>
        </div>
      </details>
    </div>
  );
}
