/**
 * EwsRiskCard — EWS 위험 수강생 카드 + Quick Action (낙관적 업데이트 적용)
 *
 * 개선 ①: onMutate로 falsep 처리 시 캐시에서 즉시 제거 → 네트워크 지연 무관하게 매끄러운 UX
 * 개선 ④: InstructorDashboard에서 분리된 단일 책임 컴포넌트
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RISK_BADGE } from './StudentRow';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface EwsStudent {
  scoreId: string;
  studentId: string;
  displayName: string | null;
  anonymousId: string;
  githubRepo: string | null;
  courseId: string | null;
  totalScore: number;
  componentScores: Record<string, number> | null;
  calculatedAt: string;
  riskLevel: 'critical' | 'risk';
}

export function EwsRiskCard({
  student,
  token,
  onActionDone,
}: {
  student: EwsStudent;
  token: string;
  onActionDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<null | 'falsep' | 'booking' | 'memo'>(null);
  const [note, setNote] = useState('');
  const [memoText, setMemoText] = useState('');

  // ── 허위 양성 처리 (개선①: 낙관적 업데이트 — 즉시 카드 제거) ──────────────
  const falsepMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/ews/scores/${student.scoreId}/feedback`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isFalsePositive: true, instructorNote: note || undefined }),
      });
      if (!res.ok) throw new Error('피드백 처리 실패');
    },
    // 낙관적 업데이트: 버튼을 누르는 순간 목록에서 제거
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['instructor-ews'] });
      const previous = queryClient.getQueryData<EwsStudent[]>(['instructor-ews']);
      queryClient.setQueryData<EwsStudent[]>(
        ['instructor-ews'],
        (old) => old?.filter((s) => s.scoreId !== student.scoreId) ?? [],
      );
      return { previous };
    },
    // 실패 시 롤백
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['instructor-ews'], context.previous);
      }
    },
    // 성공/실패 모두 서버 재동기화
    onSettled: onActionDone,
  });

  // ── Quick Action ① — 상담 예약 즉시 생성 ────────────────────────────────
  const bookingMutation = useMutation({
    mutationFn: async () => {
      if (!student.courseId) throw new Error('과목 정보가 없습니다.');
      const res = await fetch(`${API_BASE}/admin/ews/consultations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          studentId: student.studentId,
          courseId: student.courseId,
          triggeredByScoreId: student.scoreId,
        }),
      });
      if (!res.ok) throw new Error('상담 예약 생성 실패');
    },
    onSuccess: () => { setSection(null); onActionDone(); },
  });

  // ── Quick Action ② — 강사 상담 메모 추가 ────────────────────────────────
  const memoMutation = useMutation({
    mutationFn: async () => {
      if (!student.courseId) throw new Error('과목 정보가 없습니다.');
      const res = await fetch(`${API_BASE}/admin/ews/counseling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          studentId: student.studentId,
          courseId: student.courseId,
          sentiment: 'neutral',
          summary: memoText || undefined,
        }),
      });
      if (!res.ok) throw new Error('메모 추가 실패');
    },
    onSuccess: () => { setSection(null); setMemoText(''); onActionDone(); },
  });

  const name = student.displayName ?? student.anonymousId;
  const badge = RISK_BADGE[student.riskLevel];
  const date = new Date(student.calculatedAt).toLocaleDateString('ko-KR', {
    month: 'short', day: 'numeric',
  });

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <div>
            <p className="font-semibold text-gray-800 text-sm">{name}</p>
            {student.githubRepo && (
              <a
                href={`https://github.com/${student.githubRepo}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                {student.githubRepo}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
          <span className="text-lg font-bold text-gray-900">{student.totalScore}점</span>
          <span className="text-xs text-gray-400">{date}</span>
        </div>
      </div>

      {/* 컴포넌트 점수 */}
      {student.componentScores && (
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(student.componentScores).map(([key, val]) => (
            <span key={key} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-lg">
              {key}: <strong>{val}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Quick Action 버튼 그룹 */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setSection(section === 'booking' ? null : 'booking')}
          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
            section === 'booking'
              ? 'bg-blue-500 text-white border-blue-500'
              : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
          }`}
        >
          📋 상담 예약
        </button>
        <button
          onClick={() => setSection(section === 'memo' ? null : 'memo')}
          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
            section === 'memo'
              ? 'bg-indigo-500 text-white border-indigo-500'
              : 'bg-white text-indigo-600 border-indigo-300 hover:bg-indigo-50'
          }`}
        >
          💬 상담 메모
        </button>
        <button
          onClick={() => setSection(section === 'falsep' ? null : 'falsep')}
          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
            section === 'falsep'
              ? 'bg-gray-500 text-white border-gray-500'
              : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
          }`}
        >
          🚫 허위 양성
        </button>
      </div>

      {/* 상담 예약 폼 */}
      {section === 'booking' && (
        <div className="mt-3 bg-blue-50 rounded-xl p-3 space-y-2">
          <p className="text-xs text-blue-700 font-medium">
            {name} 수강생에 대해 상담 예약을 즉시 생성합니다.
          </p>
          {!student.courseId && (
            <p className="text-xs text-red-500">이 수강생의 과목 정보가 없어 예약할 수 없습니다.</p>
          )}
          <button
            onClick={() => bookingMutation.mutate()}
            disabled={bookingMutation.isPending || !student.courseId}
            className="w-full bg-blue-500 text-white rounded-lg py-1.5 text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {bookingMutation.isPending ? '예약 중…' : '상담 예약 생성'}
          </button>
          {bookingMutation.isError && (
            <p className="text-xs text-red-500">{(bookingMutation.error as Error).message}</p>
          )}
          {bookingMutation.isSuccess && (
            <p className="text-xs text-green-600">✅ 상담 예약이 생성되었습니다.</p>
          )}
        </div>
      )}

      {/* 상담 메모 폼 */}
      {section === 'memo' && (
        <div className="mt-3 bg-indigo-50 rounded-xl p-3 space-y-2">
          <textarea
            className="w-full border border-indigo-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
            rows={2}
            placeholder="상담 내용 메모 (예: 개인 사정으로 출석 불가 확인, 다음 주 보충 예정)"
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
          />
          <button
            onClick={() => memoMutation.mutate()}
            disabled={memoMutation.isPending || !student.courseId}
            className="w-full bg-indigo-500 text-white rounded-lg py-1.5 text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors"
          >
            {memoMutation.isPending ? '저장 중…' : '메모 저장'}
          </button>
          {memoMutation.isError && (
            <p className="text-xs text-red-500">{(memoMutation.error as Error).message}</p>
          )}
        </div>
      )}

      {/* 허위 양성 폼 */}
      {section === 'falsep' && (
        <div className="mt-3 bg-gray-50 rounded-xl p-3 space-y-2">
          <p className="text-xs text-gray-600">
            허위 양성으로 처리하면 이 수강생이 목록에서 즉시 제거됩니다.
          </p>
          <textarea
            className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white"
            rows={2}
            placeholder="허위 양성 사유 (선택)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            onClick={() => falsepMutation.mutate()}
            disabled={falsepMutation.isPending}
            className="w-full bg-red-50 text-red-700 border border-red-200 rounded-lg py-1.5 text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {falsepMutation.isPending ? '처리 중…' : '허위 양성 확정'}
          </button>
          {falsepMutation.isError && (
            <p className="text-xs text-red-500">처리 중 오류가 발생했습니다. 롤백되었습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}
