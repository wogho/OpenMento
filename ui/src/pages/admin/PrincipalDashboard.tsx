/**
 * 원장 대시보드 — KPI 카드 + 위험 수강생 현황
 *
 * GET /admin/dashboard
 *  - totalStudents: 전체 수강생 수
 *  - atRiskCount: 위험 수강생 수 (30일 내 score ≥ 60)
 *  - monthlyAiCostUsd: 이번 달 AI 비용 합계
 *  - attendanceRate: 이번 달 출결율(%)
 *  - recentRiskStudents: 최근 위험 수강생 top-10
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface RiskStudent {
  studentId: string;
  totalScore: number;
  calculatedAt: string;
}

interface DashboardData {
  totalStudents: number;
  atRiskCount: number;
  monthlyAiCostUsd: number;
  attendanceRate: number | null;
  recentRiskStudents: RiskStudent[];
}

// ── KPI 카드 ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'red' | 'yellow' | 'blue';
}) {
  const accentCls =
    accent === 'green' ? 'border-l-green-400' :
    accent === 'red'   ? 'border-l-red-400' :
    accent === 'yellow'? 'border-l-yellow-400' :
    'border-l-blue-400';

  return (
    <div className={`bg-white rounded-2xl shadow-sm border-l-4 ${accentCls} p-5 flex items-center gap-4`}>
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-extrabold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── 위험 수강생 행 ─────────────────────────────────────────────────────────────

function RiskRow({ student }: { student: RiskStudent }) {
  const score = student.totalScore;
  const badgeCls =
    score >= 80 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
  const label = score >= 80 ? '심각' : '위험';
  const date = new Date(student.calculatedAt).toLocaleDateString('ko-KR', {
    month: 'short', day: 'numeric',
  });

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
          {student.studentId.slice(0, 2).toUpperCase()}
        </div>
        <span className="text-sm text-gray-700 font-mono">{student.studentId.slice(0, 12)}…</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeCls}`}>{label}</span>
        <span className="text-sm font-bold text-gray-800">{score}점</span>
        <span className="text-xs text-gray-400">{date}</span>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function PrincipalDashboard() {
  const { token } = useAuth();

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('대시보드 데이터를 불러오지 못했습니다.');
      return res.json() as Promise<DashboardData>;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
        <span className="animate-spin mr-2">⏳</span> 로딩 중…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-600 text-sm">
        대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </div>
    );
  }

  const costStr =
    data.monthlyAiCostUsd < 1
      ? `$${(data.monthlyAiCostUsd * 100).toFixed(1)}¢`
      : `$${data.monthlyAiCostUsd.toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* KPI 카드 그리드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon="👥"
          label="전체 수강생"
          value={`${data.totalStudents}명`}
          accent="blue"
        />
        <KpiCard
          icon="⚠️"
          label="위험 수강생"
          value={`${data.atRiskCount}명`}
          sub="최근 30일 EWS ≥ 60"
          accent={data.atRiskCount > 0 ? 'red' : 'green'}
        />
        <KpiCard
          icon="💰"
          label="이번 달 AI 비용"
          value={costStr}
          sub="cost_events 합계"
          accent="yellow"
        />
        <KpiCard
          icon="📋"
          label="이번 달 출결율"
          value={data.attendanceRate != null ? `${data.attendanceRate}%` : '—'}
          accent={
            data.attendanceRate == null ? 'blue' :
            data.attendanceRate >= 90 ? 'green' :
            data.attendanceRate >= 75 ? 'yellow' : 'red'
          }
        />
      </div>

      {/* 위험 수강생 목록 */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span>🚨</span> 최근 위험 수강생 Top 10
          <span className="ml-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">
            {data.atRiskCount}명
          </span>
        </h2>

        {data.recentRiskStudents.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            ✅ 현재 위험 수강생이 없습니다.
          </div>
        ) : (
          <div>
            {data.recentRiskStudents.map((s) => (
              <RiskRow key={s.studentId} student={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
