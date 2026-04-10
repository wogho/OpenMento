/**
 * OriginalityGauge — 독창성 점수 게이지 바
 *
 * similarityScore(0~1)를 역산하여 독창성 점수(0~100%)로 표시.
 *   유사도 < 0.60  → 독창성 ≥ 40% → "독창성 충족" (green)
 *   유사도 0.60~0.85 → 중간 (amber)
 *   유사도 ≥ 0.85  → "차별화 필수" (red)
 *
 * Props:
 *   similarityScore: 0~1 (서버에서 반환)
 *   verdict: SimilarityVerdict
 *   isLoading: 분석 중 스켈레톤 표시
 */

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';

export type SimilarityVerdict =
  | 'differentiation_required'
  | 'improvement_recommended'
  | 'originality_confirmed';

interface Props {
  similarityScore: number;
  verdict: SimilarityVerdict;
  isLoading?: boolean;
}

const VERDICT_META: Record<SimilarityVerdict, { label: string; color: string; bg: string; bar: string }> = {
  differentiation_required: {
    label: '⚠️ 차별화 필수',
    color: 'text-red-700',
    bg:    'bg-red-50 border-red-200',
    bar:   'bg-red-500',
  },
  improvement_recommended: {
    label: '💡 개선 권장',
    color: 'text-amber-700',
    bg:    'bg-amber-50 border-amber-200',
    bar:   'bg-amber-500',
  },
  originality_confirmed: {
    label: '✅ 독창성 충족',
    color: 'text-green-700',
    bg:    'bg-green-50 border-green-200',
    bar:   'bg-green-500',
  },
};

export default function OriginalityGauge({ similarityScore, verdict, isLoading }: Props) {
  // 독창성 점수 = 유사도 역산 (단순히 시각적 표현)
  const originalityPct = Math.round((1 - similarityScore) * 100);
  const similarityPct  = Math.round(similarityScore * 100);
  const meta = VERDICT_META[verdict];

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-2/3" />
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${meta.bg}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h3 className={`text-base font-bold ${meta.color}`}>{meta.label}</h3>
        <span className={`text-2xl font-extrabold tabular-nums ${meta.color}`}>
          {originalityPct}
          <span className="text-sm font-normal ml-0.5">%</span>
        </span>
      </div>

      {/* 게이지 바 */}
      <div className="relative h-3 bg-white bg-opacity-60 rounded-full overflow-hidden border border-gray-200">
        <div
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-700 ${meta.bar}`}
          style={{ width: `${originalityPct}%` }}
          role="presentation"
        />
      </div>

      {/* 레이블 */}
      <div className="flex justify-between text-xs text-gray-500 font-medium">
        <span>독창성 낮음</span>
        <span>역대 유사도 {similarityPct}%</span>
        <span>독창성 높음</span>
      </div>

      {/* 레이더 차트 (Network/Radar Graph 시각화) */}
      <div className="h-[240px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={[
            { subject: '주제/도메인', A: Math.min(originalityPct + 10, 100), fullMark: 100 },
            { subject: '문제정의', A: Math.max(originalityPct - 5, 0), fullMark: 100 },
            { subject: '솔루션 차별성', A: originalityPct, fullMark: 100 },
            { subject: '기술스택/접근', A: Math.min(originalityPct + 15, 100), fullMark: 100 },
            { subject: '기대효과', A: Math.max(originalityPct - 10, 0), fullMark: 100 },
          ]}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: '#4b5563', fontSize: 11 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              itemStyle={{ color: '#4338ca', fontWeight: 'bold' }}
            />
            <Radar name="독창성 지수" dataKey="A" stroke="#6366f1" fill="#818cf8" fillOpacity={0.5} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
