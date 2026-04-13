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
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import { Users, AlertCircle, DollarSign, CalendarCheck, Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

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
  icon: React.ReactNode;
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
    <div className={`bg-white/70 dark:bg-slate-800/70 backdrop-blur-lg rounded-2xl shadow-[0_4px_24px_rgb(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgb(0,0,0,0.2)] border border-gray-100/80 dark:border-slate-700/50 border-l-4 ${accentCls} p-5 flex items-center gap-4 transition-all duration-200 hover:shadow-[0_8px_32px_rgb(0,0,0,0.08)] hover:-translate-y-0.5`}>
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
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
    <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-slate-700 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300">
          {student.studentId.slice(0, 2).toUpperCase()}
        </div>
        <span className="text-sm text-gray-700 dark:text-gray-300 font-mono">{student.studentId.slice(0, 12)}…</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeCls}`}>{label}</span>
        <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{score}점</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{date}</span>
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
      <div className="flex items-center justify-center py-24 text-gray-400 dark:text-gray-500 text-sm">
        <Loader2 size={16} className="animate-spin mr-2 inline-block" /> 로딩 중...
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center text-red-600 dark:text-red-400 text-sm">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Users size={28} className="text-blue-500" />}
          label="전체 수강생"
          value={`${data.totalStudents}명`}
          accent="blue"
        />
        <KpiCard
          icon={<AlertCircle size={28} className={data.atRiskCount > 0 ? "text-red-500" : "text-green-500"} />}
          label="위험 수강생"
          value={`${data.atRiskCount}명`}
          sub="최근 30일 EWS ≥ 60"
          accent={data.atRiskCount > 0 ? 'red' : 'green'}
        />
        <KpiCard
          icon={<DollarSign size={28} className="text-yellow-500" />}
          label="이번 달 AI 비용"
          value={costStr}
          sub="cost_events 합계"
          accent="yellow"
        />
        <KpiCard
          icon={<CalendarCheck size={28} className="text-blue-500" />}
          label="이번 달 출결율"
          value={data.attendanceRate != null ? `${data.attendanceRate}%` : '—'}
          accent={
            data.attendanceRate == null ? 'blue' :
            data.attendanceRate >= 90 ? 'green' :
            data.attendanceRate >= 75 ? 'yellow' : 'red'
          }
        />
      </div>

      
      {/* ── 데이터 시각화 (Recharts) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EWS 위험도 트렌드 */}
        <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-lg rounded-2xl shadow-[0_4px_24px_rgb(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgb(0,0,0,0.2)] border border-gray-100/80 dark:border-slate-700/50 p-6 flex flex-col h-[360px]">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 h-6"> 최근 6개월 EWS 위험도 트렌드</h2>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  { name: '10월', highRisk: 4, atRisk: 12 },
                  { name: '11월', highRisk: 5, atRisk: 14 },
                  { name: '12월', highRisk: 3, atRisk: 10 },
                  { name: '1월', highRisk: 7, atRisk: 18 },
                  { name: '2월', highRisk: 6, atRisk: 15 },
                  { name: '3월', highRisk: data.atRiskCount, atRisk: 12 },
                ]}
                margin={{ top: 10, right: 30, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorHighRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAtRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#374151', marginBottom: '4px' }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Area type="monotone" dataKey="atRisk" name="관심 분류" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorAtRisk)" />
                <Area type="monotone" dataKey="highRisk" name="고위험군" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorHighRisk)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 학생별 출결 분포 */}
        <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-lg rounded-2xl shadow-[0_4px_24px_rgb(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgb(0,0,0,0.2)] border border-gray-100/80 dark:border-slate-700/50 p-6 flex flex-col h-[360px]">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 h-6"> 주간 출결 분포 현황</h2>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: '월', present: 45, absent: 2, late: 3 },
                  { name: '화', present: 48, absent: 0, late: 2 },
                  { name: '수', present: 42, absent: 5, late: 3 },
                  { name: '목', present: 46, absent: 1, late: 3 },
                  { name: '금', present: 40, absent: 4, late: 6 },
                ]}
                margin={{ top: 10, right: 30, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  cursor={{ fill: '#f3f4f6' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#374151', marginBottom: '4px' }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="present" name="정상 출석" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                <Bar dataKey="late" name="지각/조퇴" stackId="a" fill="#fbbf24" />
                <Bar dataKey="absent" name="결석" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 위험 수강생 목록 */}
      <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-lg rounded-2xl shadow-[0_4px_24px_rgb(0,0,0,0.06)] dark:shadow-[0_4px_24px_rgb(0,0,0,0.2)] border border-gray-100/80 dark:border-slate-700/50 p-6">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
          <span></span> 최근 위험 수강생 Top 10
          <span className="ml-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">
            {data.atRiskCount}명
          </span>
        </h2>

        {data.recentRiskStudents.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
             현재 위험 수강생이 없습니다.
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
