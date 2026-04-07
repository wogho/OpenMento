/**
 * 강사 대시보드 — 담당 수강생 현황 + EWS 위험 수강생 목록 + Quick Action
 *
 * GET /instructor/students   — 수강생 현황 (페이지네이션: ?limit=20&offset=0)
 * GET /instructor/ews        — 위험 수강생 목록 (courseId 포함)
 * PUT /admin/ews/scores/:scoreId/feedback — 허위 양성 처리
 * POST /admin/ews/consultations           — 상담 예약 즉시 생성 [Quick Action ①]
 * POST /admin/ews/counseling              — 강사 메모 추가       [Quick Action ②]
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const PAGE_SIZE = 20;

// ── 타입 ──────────────────────────────────────────────────────────────────────

type RiskLevel = 'critical' | 'risk' | 'normal' | 'unknown';

interface StudentSummary {
  id: string;
  anonymousId: string;
  displayName: string | null;
  githubRepo: string | null;
  courseId: string | null;
  enrolledAt: string | null;
  latestEwsScore: number | null;
  scoreCalculatedAt: string | null;
  riskLevel: RiskLevel;
}

interface StudentPage {
  total: number;
  limit: number;
  offset: number;
  items: StudentSummary[];
}

interface EwsStudent {
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

// ── 상수 ──────────────────────────────────────────────────────────────────────

const RISK_BADGE: Record<RiskLevel, { cls: string; label: string }> = {
  critical: { cls: 'bg-red-100 text-red-800',      label: '심각' },
  risk:     { cls: 'bg-yellow-100 text-yellow-800', label: '위험' },
  normal:   { cls: 'bg-green-100 text-green-700',   label: '정상' },
  unknown:  { cls: 'bg-gray-100 text-gray-500',     label: '미측정' },
};

// ── 수강생 행 ─────────────────────────────────────────────────────────────────

function StudentRow({ student }: { student: StudentSummary }) {
  const badge = RISK_BADGE[student.riskLevel];
  const name = student.displayName ?? student.anonymousId;
  const scoreDate = student.scoreCalculatedAt
    ? new Date(student.scoreCalculatedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : null;

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

// ── EWS 위험 카드 (Quick Action + 허위 양성 처리) ──────────────────────────────

function EwsCard({
  student,
  token,
  onActionDone,
}: {
  student: EwsStudent;
  token: string;
  onActionDone: () => void;
}) {
  const [section, setSection] = useState<null | 'falsep' | 'booking' | 'memo'>(null);
  const [note, setNote] = useState('');
  const [memoText, setMemoText] = useState('');

  // 허위 양성 처리
  const falsepMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/ews/scores/${student.scoreId}/feedback`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isFalsePositive: true, instructorNote: note || undefined }),
      });
      if (!res.ok) throw new Error('피드백 처리 실패');
    },
    onSuccess: onActionDone,
  });

  // Quick Action ① — 상담 예약 즉시 생성
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

  // Quick Action ② — 강사 상담 메모 추가
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
            <p className="text-xs text-red-500">처리 중 오류가 발생했습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function InstructorDashboard() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'students' | 'ews'>('students');
  const [page, setPage] = useState(0);

  const studentsQuery = useQuery<StudentPage>({
    queryKey: ['instructor-students', page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      const res = await fetch(`${API_BASE}/instructor/students?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('수강생 목록 조회 실패');
      return res.json() as Promise<StudentPage>;
    },
    enabled: activeTab === 'students',
    staleTime: 60_000,
  });

  const ewsQuery = useQuery<EwsStudent[]>({
    queryKey: ['instructor-ews'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/instructor/ews`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('EWS 조회 실패');
      return res.json() as Promise<EwsStudent[]>;
    },
    enabled: activeTab === 'ews',
    staleTime: 60_000,
  });

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ['instructor-ews'] });
    queryClient.invalidateQueries({ queryKey: ['instructor-students'] });
    // Quick Action 이후 대시보드 KPI도 갱신
    queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] });
  };

  const totalPages = studentsQuery.data
    ? Math.ceil(studentsQuery.data.total / PAGE_SIZE)
    : 0;

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex border-b border-gray-200">
        {(['students', 'ews'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(0); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'students' ? '👥 수강생 현황' : '⚠️ 위험 수강생'}
            {tab === 'ews' && ewsQuery.data && ewsQuery.data.length > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {ewsQuery.data.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 수강생 현황 탭 */}
      {activeTab === 'students' && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          {studentsQuery.isLoading && (
            <div className="text-center py-12 text-gray-400 text-sm animate-pulse">⏳ 로딩 중…</div>
          )}
          {studentsQuery.isError && (
            <div className="text-center text-red-500 text-sm py-8">데이터를 불러오지 못했습니다.</div>
          )}
          {studentsQuery.data && (
            <>
              <p className="text-xs text-gray-500 mb-3">
                총 {studentsQuery.data.total}명 · 페이지 {page + 1} / {totalPages || 1}
              </p>
              {studentsQuery.data.items.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">등록된 수강생이 없습니다.</p>
              ) : (
                studentsQuery.data.items.map((s) => <StudentRow key={s.id} student={s} />)
              )}

              {/* 페이지네이션 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    ← 이전
                  </button>
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      const pageNum = totalPages <= 7 ? i : Math.max(0, Math.min(page - 3, totalPages - 7)) + i;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`w-7 h-7 text-xs rounded-lg transition-colors ${
                            pageNum === page
                              ? 'bg-blue-500 text-white'
                              : 'hover:bg-gray-100 text-gray-600'
                          }`}
                        >
                          {pageNum + 1}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    다음 →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* EWS 위험 탭 */}
      {activeTab === 'ews' && (
        <div className="space-y-3">
          {ewsQuery.isLoading && (
            <div className="text-center py-12 text-gray-400 text-sm animate-pulse">⏳ 로딩 중…</div>
          )}
          {ewsQuery.isError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm text-center">
              데이터를 불러오지 못했습니다.
            </div>
          )}
          {ewsQuery.data && ewsQuery.data.length === 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center text-green-700 text-sm">
              ✅ 현재 위험 수강생이 없습니다.
            </div>
          )}
          {ewsQuery.data?.map((s) => (
            <EwsCard key={s.scoreId} student={s} token={token ?? ''} onActionDone={handleActionDone} />
          ))}
        </div>
      )}
    </div>
  );
}
