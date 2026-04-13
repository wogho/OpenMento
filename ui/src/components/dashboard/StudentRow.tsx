/**
 * StudentRow — 수강생 현황 테이블 행 컴포넌트 (단일 책임 프레젠테이션)
 */

import { MessageCircle } from 'lucide-react';

export type RiskLevel = 'critical' | 'risk' | 'normal' | 'unknown';

export interface StudentSummary {
  id: string;
  anonymousId: string;
  displayName: string | null;
  githubRepo: string | null;
  courseId: string | null;
  enrolledAt: string | null;
  latestEwsScore: number | null;
  scoreCalculatedAt: string | null;
  pendingInstructorCallCount?: number;
  pendingNotificationId?: string | null;
  riskLevel: RiskLevel;
}

export interface StudentPage {
  total: number;
  limit: number;
  offset: number;
  items: StudentSummary[];
}

export const RISK_BADGE: Record<RiskLevel, { cls: string; label: string }> = {
  critical: { cls: 'bg-red-100 text-red-800',      label: '심각' },
  risk:     { cls: 'bg-yellow-100 text-yellow-800', label: '위험' },
  normal:   { cls: 'bg-green-100 text-green-700',   label: '정상' },
  unknown:  { cls: 'bg-gray-100 text-gray-500',     label: '미측정' },
};

export function StudentRow({
  student,
  onOpenChat,
}: {
  student: StudentSummary;
  onOpenChat?: (notificationId: string) => void;
}) {
  const badge = RISK_BADGE[student.riskLevel];
  const name = student.displayName ?? student.anonymousId;
  const scoreDate = student.scoreCalculatedAt
    ? new Date(student.scoreCalculatedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : null;
  const pendingCount = student.pendingInstructorCallCount ?? 0;
  const hasPendingCall = Boolean(student.pendingNotificationId && pendingCount > 0);

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors px-2 rounded-lg">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
          {name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{name}</p>
          {student.githubRepo && (
            <a
              href={`https://github.com/${student.githubRepo}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-500 hover:underline truncate block"
            >
              {student.githubRepo}
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          disabled={!hasPendingCall}
          onClick={() => {
            if (student.pendingNotificationId && onOpenChat) {
              onOpenChat(student.pendingNotificationId);
            }
          }}
          title={hasPendingCall ? `강사 호출 ${pendingCount}건` : '대기 중인 강사 호출 없음'}
          className={`relative inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            hasPendingCall
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 animate-pulse'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          <MessageCircle size={12} />
          채팅
          {hasPendingCall && (
            <span className="inline-flex min-w-[16px] justify-center rounded-full bg-amber-500 px-1 text-[10px] text-white">
              {pendingCount}
            </span>
          )}
        </button>
        {student.latestEwsScore != null && (
          <span className="text-sm font-bold text-gray-700">{student.latestEwsScore}점</span>
        )}
        {scoreDate && <span className="text-xs text-gray-400">{scoreDate}</span>}
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
    </div>
  );
}
