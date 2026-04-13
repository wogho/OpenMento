/**
 * 출결 대시보드 (구: EWS 대시보드) — 자동 상담 예약 관리 + 멘탈케어 메시지 읽음 확인
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { Users } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

// ── 타입 정의 ────────────────────────────────────────────────────────────────

type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

interface Booking {
  id: string;
  studentId: string;
  courseId: string;
  status: BookingStatus;
  requestedAt: string;
  completedAt: string | null;
  notes: string | null;
  triggeredByScoreId: string | null;
}

interface MentalCareMessage {
  id: string;
  studentId: string;
  courseId: string;
  content: string;
  isAdminRead: boolean;
  createdAt: string;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending:   '대기중',
  confirmed: '확인됨',
  completed: '완료',
  cancelled: '취소',
};

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending:   'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
};

// ── 서브 컴포넌트: 상담 예약 카드 ────────────────────────────────────────────

function BookingCard({
  booking,
  token,
  onUpdated,
}: {
  booking: Booking;
  token: string;
  onUpdated: () => void;
}) {
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [expanded, setExpanded] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (status: BookingStatus) => {
      const res = await fetch(`${API_BASE}/admin/ews/consultations/${booking.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, notes: notes || undefined }),
      });
      if (!res.ok) throw new Error('상태 변경 실패');
    },
    onSuccess: onUpdated,
  });

  const updateStatus = (status: BookingStatus) => updateMutation.mutate(status);

  const shortId = booking.studentId.slice(0, 8);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {/* 헤더 */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg"></span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">
              수강생 <code className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1 rounded text-xs">{shortId}…</code>
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {new Date(booking.requestedAt).toLocaleString('ko-KR')}
            </p>
          </div>
        </div>

        {/* 상태 배지 */}
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[booking.status]}`}>
          {STATUS_LABEL[booking.status]}
        </span>
      </div>

      {/* EWS 점수 추적 */}
      {booking.triggeredByScoreId && (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">
          트리거 점수 ID: {booking.triggeredByScoreId}
        </p>
      )}

      {/* 상세 펼치기 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-xs text-blue-500 dark:text-blue-400 hover:underline"
      >
        {expanded ? '▲ 접기' : '▼ 상태 변경 / 메모'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <textarea
            className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            rows={2}
            placeholder="상담 메모 입력 (선택)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {(['confirmed', 'completed', 'cancelled'] as BookingStatus[])
              .filter((s) => s !== booking.status)
              .map((s) => (
                <button
                  key={s}
                  disabled={updateMutation.isPending}
                  onClick={() => updateStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50
                    ${s === 'completed' ? 'bg-green-500 text-white hover:bg-green-600' :
                      s === 'confirmed' ? 'bg-blue-500 text-white hover:bg-blue-600' :
                      'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
                >
                  {STATUS_LABEL[s]}(으)로 변경
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트: 멘탈케어 메시지 카드 ────────────────────────────────────────

function MentalCareCard({
  message,
  token,
  onRead,
}: {
  message: MentalCareMessage;
  token: string;
  onRead: (id: string) => void;
}) {
  const readMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `${API_BASE}/admin/ews/mental-care-messages/${message.id}/read`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error('읽음 처리 실패');
    },
    onSuccess: () => onRead(message.id),
  });

  const shortStudent = message.studentId.slice(0, 8);

  return (
    <div className={`border rounded-xl p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm transition-opacity ${message.isAdminRead ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg shrink-0"></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              수강생 <code className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-1 rounded">{shortStudent}…</code>
              {' · '}
              {new Date(message.createdAt).toLocaleString('ko-KR')}
            </p>
            {message.isAdminRead ? (
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium"> 확인됨</span>
            ) : (
              <button
                disabled={readMutation.isPending}
                onClick={() => readMutation.mutate()}
                className="px-2.5 py-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition disabled:opacity-50"
              >
                읽음 확인
              </button>
            )}
          </div>
          <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type EwsTab = 'students' | 'bookings' | 'messages' | 'slack';

type MainEwsTab = 'openmento' | 'lms';

export default function EwsDashboard() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<EwsTab>('students');
  const [mainTab, setMainTab] = useState<MainEwsTab>('openmento');
  const [lmsMode, setLmsMode] = useState<'api'|'db'>('api');
  const [lmsConnected, setLmsConnected] = useState(false);
  const [syncAttendance, setSyncAttendance] = useState(false);

  // 필터 상태
  const [bookingFilter, setBookingFilter] = useState<BookingStatus | 'all'>('pending');
  const [unreadOnly, setUnreadOnly] = useState(true);

  // Slack 테스트 결과 (단순 UI 상태 → useState 유지)
  const [slackResult, setSlackResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── 상담 예약 조회 ─────────────────────────────────────────────────────────
  const {
    data: bookingData,
    isLoading: bookingLoading,
    isError: bookingIsError,
    error: bookingErr,
    refetch: refetchBookings,
  } = useQuery({
    queryKey: ['ews-bookings', bookingFilter, token],
    queryFn: async () => {
      const url = bookingFilter === 'all'
        ? `${API_BASE}/admin/ews/consultations`
        : `${API_BASE}/admin/ews/consultations?status=${bookingFilter}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json() as { bookings?: Booking[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '조회 실패');
      return data.bookings ?? [];
    },
    enabled: !!token,
  });

  const bookings = bookingData ?? [];
  const bookingError = bookingIsError
    ? (bookingErr instanceof Error ? bookingErr.message : '오류 발생')
    : null;

  // ── 멘탈케어 메시지 조회 ───────────────────────────────────────────────────
  const {
    data: messagesData,
    isLoading: msgLoading,
    isError: msgIsError,
    error: msgErr,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['ews-messages', unreadOnly, token],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/admin/ews/mental-care-messages?unread=${unreadOnly}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json() as { messages?: MentalCareMessage[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? '조회 실패');
      return data.messages ?? [];
    },
    enabled: !!token,
  });

  const messages = messagesData ?? [];
  const msgError = msgIsError
    ? (msgErr instanceof Error ? msgErr.message : '오류 발생')
    : null;

  // ── 전체 읽음 뮤테이션 ─────────────────────────────────────────────────────
  const readAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/ews/mental-care-messages/read-all`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('전체 읽음 처리 실패');
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['ews-messages'] }),
  });

  // ── 단일 메시지 읽음 완료 후 캐시 갱신 ────────────────────────────────────
  const handleSingleRead = (id: string) => {
    queryClient.setQueryData<MentalCareMessage[]>(
      ['ews-messages', unreadOnly, token],
      (prev) => prev?.map((m) => m.id === id ? { ...m, isAdminRead: true } : m) ?? [],
    );
  };

  // ── Slack 테스트 뮤테이션 ──────────────────────────────────────────────────
  const slackMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/ews/slack-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      return { ok: res.ok && !!data.success, msg: data.message ?? data.error ?? (res.ok ? '성공' : '실패') };
    },
    onSuccess: (result) => setSlackResult(result),
    onError: () => setSlackResult({ ok: false, msg: '네트워크 오류' }),
  });

  // ── 전체 출결 현황 쿼리 ──────────────────────────────────────────────────
  interface AttendanceSummaryRow {
    id: string;
    displayName: string | null;
    email: string | null;
    courses: { courseId: string; courseName: string }[];
    present: number;
    absent: number;
    late: number;
    excused: number;
    total: number;
    rate: number | null;
  }
  const {
    data: attendanceSummaryData,
    isLoading: attendanceLoading,
  } = useQuery<{ summary: AttendanceSummaryRow[] }>({
    queryKey: ['attendance-summary', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/attendance/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('출결 현황 조회 실패');
      return res.json();
    },
    enabled: !!token && tab === 'students' && mainTab === 'openmento',
  });
  const attendanceSummary = attendanceSummaryData?.summary ?? [];

  // ── 탭 정의 ───────────────────────────────────────────────────────────────
  const tabs: { id: EwsTab; label: string; icon: string }[] = [
    { id: 'students', label: '전체 출결 현황', icon: '' },
    { id: 'bookings', label: '상담 예약', icon: '' },
    { id: 'messages', label: '멘탈케어 메시지', icon: '' },
    { id: 'slack',    label: 'Slack 연동',    icon: '' },
  ];

  return (
    <div className="space-y-6">
      {/* ── 통합 메인 탭 ── */}
      <div className="flex items-center gap-6 border-b border-gray-200 dark:border-gray-700 pb-2">
        <button
          onClick={() => setMainTab('openmento')}
          className={`pb-3 text-lg font-bold transition-all border-b-2 ${
            mainTab === 'openmento'
              ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
              : 'text-gray-400 dark:text-gray-500 border-transparent hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          OpenMento EWS
        </button>
        <button
          onClick={() => setMainTab('lms')}
          className={`pb-3 text-lg font-bold transition-all border-b-2 ${
            mainTab === 'lms'
              ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
              : 'text-gray-400 dark:text-gray-500 border-transparent hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          LMS EWS 연동
        </button>
      </div>

      {mainTab === 'openmento' ? (
        <div className="space-y-6">
          {/* 탭 내비게이션 */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.id
                ? 'bg-white dark:bg-gray-800 border border-b-white dark:border-b-gray-800 border-gray-200 dark:border-gray-700 text-blue-700 dark:text-blue-400 -mb-px'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
          >
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── 전체 출결 현황 탭 ── */}
      {tab === 'students' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Users size={16} className="text-blue-500" /> 전체 출결 현황
            </h2>
            <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded-full">
              총 {attendanceSummary.length}명
            </span>
          </div>

          {/* 출결 요약 카드 */}
          {(() => {
            const totalPresent = attendanceSummary.reduce((a, s) => a + s.present, 0);
            const totalAbsent  = attendanceSummary.reduce((a, s) => a + s.absent, 0);
            const totalLate    = attendanceSummary.reduce((a, s) => a + s.late, 0);
            const totalExcused = attendanceSummary.reduce((a, s) => a + s.excused, 0);
            const totalAll     = totalPresent + totalAbsent + totalLate + totalExcused;
            const overallRate  = totalAll > 0 ? Math.round(((totalPresent + totalLate) / totalAll) * 100) : null;
            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
                    <Users size={16} className="text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">전체 출석률</p>
                    <p className="text-xl font-bold text-blue-700 dark:text-blue-300">
                      {overallRate !== null ? `${overallRate}%` : '—'}
                    </p>
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-green-500 flex items-center justify-center shrink-0 text-white font-bold text-sm">O</div>
                  <div>
                    <p className="text-xs text-green-600 dark:text-green-400 font-medium">출석</p>
                    <p className="text-xl font-bold text-green-700 dark:text-green-300">{totalPresent}</p>
                  </div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-500 flex items-center justify-center shrink-0 text-white font-bold text-sm">X</div>
                  <div>
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">결석</p>
                    <p className="text-xl font-bold text-red-700 dark:text-red-300">{totalAbsent}</p>
                  </div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center shrink-0 text-white font-bold text-sm">L</div>
                  <div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">지각</p>
                    <p className="text-xl font-bold text-amber-700 dark:text-amber-300">{totalLate}</p>
                  </div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-500 flex items-center justify-center shrink-0 text-white font-bold text-sm">A</div>
                  <div>
                    <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">공결</p>
                    <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{totalExcused}</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 수강생별 출결 테이블 */}
          {attendanceLoading ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">로딩 중...</p>
          ) : (
            <div className="overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">이름</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">수강 과목</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-green-600 dark:text-green-400">O 출석</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-red-500 dark:text-red-400">X 결석</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-amber-500 dark:text-amber-400">L 지각</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-purple-600 dark:text-purple-400">A 공결</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">출석률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {attendanceSummary.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">
                        출결 기록이 없습니다.
                      </td>
                    </tr>
                  )}
                  {attendanceSummary.map((s, i) => (
                    <tr key={s.id} className={i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-700/20'}>
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                        {s.displayName ?? <span className="text-gray-400 dark:text-gray-500 text-xs">(이름 없음)</span>}
                      </td>
                      <td className="px-4 py-3">
                        {s.courses.length === 0 ? (
                          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {s.courses.map(c => (
                              <span key={c.courseId} className="text-[10px] px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full">
                                {c.courseName}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-green-600 dark:text-green-400">{s.present > 0 ? s.present : <span className="text-gray-300 dark:text-gray-600">0</span>}</td>
                      <td className="px-4 py-3 text-center font-semibold text-red-500 dark:text-red-400">{s.absent > 0 ? s.absent : <span className="text-gray-300 dark:text-gray-600">0</span>}</td>
                      <td className="px-4 py-3 text-center font-semibold text-amber-500 dark:text-amber-400">{s.late > 0 ? s.late : <span className="text-gray-300 dark:text-gray-600">0</span>}</td>
                      <td className="px-4 py-3 text-center font-semibold text-purple-600 dark:text-purple-400">{s.excused > 0 ? s.excused : <span className="text-gray-300 dark:text-gray-600">0</span>}</td>
                      <td className="px-4 py-3 text-center">
                        {s.rate !== null ? (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            s.rate >= 80 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : s.rate >= 60 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>{s.rate}%</span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">기록 없음</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── 상담 예약 탭 ── */}
      {tab === 'bookings' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">EWS 자동 생성 상담 예약</h2>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'pending', 'confirmed', 'completed', 'cancelled'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setBookingFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition
                    ${bookingFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                >
                  {s === 'all' ? '전체' : STATUS_LABEL[s]}
                </button>
              ))}
              <button
                onClick={() => void refetchBookings()}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition"
                title="새로고침"
              >
                ↻ 새로고침
              </button>
            </div>
          </div>

          {bookingLoading && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">로딩 중...</p>
          )}
          {bookingError && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{bookingError}</p>
          )}
          {!bookingLoading && bookings.length === 0 && !bookingError && (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <p className="text-4xl mb-2"></p>
              <p className="font-medium">해당하는 상담 예약이 없습니다.</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {bookings.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                token={token ?? ''}
                onUpdated={() => queryClient.invalidateQueries({ queryKey: ['ews-bookings'] })}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── 멘탈케어 메시지 탭 ── */}
      {tab === 'messages' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">멘탈케어 안부 메시지</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                미확인만 보기
              </label>
              <button
                onClick={() => void refetchMessages()}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 transition"
              >
                ↻ 새로고침
              </button>
              {messages.some((m) => !m.isAdminRead) && (
                <button
                  disabled={readAllMutation.isPending}
                  onClick={() => readAllMutation.mutate()}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition disabled:opacity-50"
                >
                  전체 읽음 처리
                </button>
              )}
            </div>
          </div>

          {msgLoading && (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">로딩 중...</p>
          )}
          {msgError && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{msgError}</p>
          )}
          {!msgLoading && messages.length === 0 && !msgError && (
            <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <p className="text-4xl mb-2"></p>
              <p className="font-medium">
                {unreadOnly ? '미확인 메시지가 없습니다.' : '생성된 메시지가 없 습니다.'}
              </p>
            </div>
          )}
          <div className="space-y-3">
            {messages.map((m) => (
              <MentalCareCard
                key={m.id}
                message={m}
                token={token ?? ''}
                onRead={handleSingleRead}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Slack 연동 탭 ── */}
      {tab === 'slack' && (
        <section className="space-y-6">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">Slack Webhook 연동 테스트</h2>

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 text-sm text-blue-800 dark:text-blue-300 space-y-1">
            <p className="font-semibold">Slack Webhook URL 설정 안내</p>
            <p>
              Slack Webhook URL은 <strong>보안 키 관리</strong> 탭에서{' '}
              <code className="bg-blue-100 dark:bg-blue-800/50 px-1 rounded">slackWebhookUrl</code> 키로 등록하세요.
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              EWS 위험 점수 60점 이상 수강생 감지 시 자동으로 발송됩니다.
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">에스컬레이션 정책</p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 list-none">
                <li><span className="inline-block w-5 mr-1">️</span>60~74점 — 담당 강사 채널 알림</li>
                <li><span className="inline-block w-5 mr-1"></span>75~89점 — 강사 + 원장 채널 + 멘탈케어 메시지</li>
                <li><span className="inline-block w-5 mr-1"></span>90~100점 — 전 단계 + 상담 예약 자동 생성</li>
              </ul>
            </div>

            <hr className="border-gray-100 dark:border-gray-700" />

            <div className="flex items-center gap-3">
              <button
                disabled={slackMutation.isPending}
                onClick={() => { setSlackResult(null); slackMutation.mutate(); }}
                className="px-4 py-2 bg-[#4A154B] text-white text-sm font-medium rounded-lg hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
              >
                {slackMutation.isPending ? (
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <span></span>
                )}
                Slack 테스트 메시지 발송
              </button>

              {slackResult && (
                <p className={`text-sm font-medium ${slackResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                  {slackResult.ok ? ' ' : ' '}{slackResult.msg}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
        </div>
      ) : (
        <div className="space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-8 border border-gray-100 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">LMS 연동 방식 설정</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">외부 시스템의 출결, 성적, 진도율 데이터를 수집하여 보다 정교한 EWS 분석을 수행합니다.</p>
          </div>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 dark:text-gray-300">
              <input type="radio" value="api" checked={lmsMode === 'api'} onChange={() => setLmsMode('api')} className="accent-blue-600 w-4 h-4" /> API (Webhook) 기반
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-gray-700 dark:text-gray-300">
              <input type="radio" value="db" checked={lmsMode === 'db'} onChange={() => setLmsMode('db')} className="accent-blue-600 w-4 h-4" /> 데이터베이스 직접 연결
            </label>
          </div>

          {lmsMode === 'api' ? (
            <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 p-5 rounded-xl text-sm text-gray-700 dark:text-gray-300 space-y-3">
              <p>LMS 서버에서 다음 엔드포인트로 JSON 출결 이벤트를 PUSH 하십시오:</p>
              <code className="block bg-gray-800 dark:bg-gray-900 text-green-400 p-3 rounded-lg shadow-inner font-mono">POST {API_BASE}/lms-webhook/attendance</code>
              <p>요청 헤더에는 HMAC-SHA256 방식의 <code className="bg-white dark:bg-gray-700 border dark:border-gray-600 text-red-600 dark:text-red-400 px-1 rounded">x-signature-256</code> 서명을 포함해야 안전하게 연동됩니다.</p>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 p-5 rounded-xl space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="DB Host (단방향 방화벽 허용 IP)" className="border dark:border-gray-600 p-2.5 rounded-xl text-sm w-full outline-blue-500 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500" />
                <input type="text" placeholder="DB Port" className="border dark:border-gray-600 p-2.5 rounded-xl text-sm w-full outline-blue-500 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500" />
                <input type="text" placeholder="DB Username" className="border dark:border-gray-600 p-2.5 rounded-xl text-sm w-full outline-blue-500 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500" />
                <input type="password" placeholder="DB Password" className="border dark:border-gray-600 p-2.5 rounded-xl text-sm w-full outline-blue-500 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500" />
              </div>
              <p className="text-xs text-red-500 dark:text-red-400 font-medium tracking-wide">
                * 강력한 보안 정책에 의해, 인가된 서버 방화벽 내에서만 접속 가능합니다.
              </p>
            </div>
          )}

          <div className="flex items-center gap-4 pt-6 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setLmsConnected(!lmsConnected)}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95 ${lmsConnected ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              {lmsConnected ? 'DB / API 연동 끊기' : '연결 테스트 & 구성 저장'}
            </button>
            {lmsConnected && <span className="text-sm text-green-600 dark:text-green-400 font-bold px-2 py-1 bg-green-50 dark:bg-green-900/20 rounded-lg">✓ 연동 확인됨 (데이터 수신 대기중)</span>}
          </div>

          <div className={`mt-8 p-5 rounded-2xl border transition-opacity duration-300 ${lmsConnected ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-700' : 'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600 opacity-50 pointer-events-none'}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-base">EWS 출결 동기화 활성화</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  활성화 시, LMS에서 수집한 '지각/결석/조퇴' 데이터를 실시간으로 OpenMento EWS 위험 점수에 반영합니다.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4">
                <input type="checkbox" className="sr-only peer" checked={syncAttendance} onChange={(e) => setSyncAttendance(e.target.checked)} disabled={!lmsConnected} />
                <div className="w-12 h-7 bg-gray-300 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}