/**
 * EWS 대시보드 — 자동 상담 예약 관리 + 멘탈케어 메시지 읽음 확인
 *
 * plan.md Phase 2-4 개선 (Gemini 제언 반영):
 *  - GET  /admin/ews/consultations       — 상담 예약 목록 조회
 *  - PUT  /admin/ews/consultations/:id   — 상담 예약 상태 변경
 *  - GET  /admin/ews/mental-care-messages — 미확인 멘탈케어 메시지
 *  - PATCH /admin/ews/mental-care-messages/:id/read — 읽음 처리
 *  - PATCH /admin/ews/mental-care-messages/read-all — 전체 읽음
 *  - POST  /admin/ews/slack-test          — Slack 연결 테스트
 *
 * React Query(@tanstack/react-query) 기반 데이터 페칭:
 *  - 자동 캐싱 및 탭 전환 시 빠른 화면 복원
 *  - 낙관적 업데이트(읽음 처리 즉시 반영)
 *  - 뮤테이션 완료 후 관련 query 자동 무효화(invalidateQueries)
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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
    <div className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {/* 헤더 */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">🚨</span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">
              수강생 <code className="bg-gray-100 px-1 rounded text-xs">{shortId}…</code>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
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
        <p className="mt-2 text-[11px] text-gray-400 font-mono truncate">
          트리거 점수 ID: {booking.triggeredByScoreId}
        </p>
      )}

      {/* 상세 펼치기 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-xs text-blue-500 hover:underline"
      >
        {expanded ? '▲ 접기' : '▼ 상태 변경 / 메모'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          <textarea
            className="w-full text-sm border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
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
                      'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
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
    <div className={`border rounded-xl p-4 bg-white shadow-sm transition-opacity ${message.isAdminRead ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg shrink-0">💬</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-gray-500">
              수강생 <code className="bg-gray-100 px-1 rounded">{shortStudent}…</code>
              {' · '}
              {new Date(message.createdAt).toLocaleString('ko-KR')}
            </p>
            {message.isAdminRead ? (
              <span className="text-xs text-gray-400 font-medium">✓ 확인됨</span>
            ) : (
              <button
                disabled={readMutation.isPending}
                onClick={() => readMutation.mutate()}
                className="px-2.5 py-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition disabled:opacity-50"
              >
                읽음 확인
              </button>
            )}
          </div>
          <p className="mt-1.5 text-sm text-gray-700 leading-relaxed line-clamp-3">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type EwsTab = 'bookings' | 'messages' | 'slack';

export default function EwsDashboard() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<EwsTab>('bookings');

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

  // ── 탭 정의 ───────────────────────────────────────────────────────────────
  const tabs: { id: EwsTab; label: string; icon: string }[] = [
    { id: 'bookings', label: '상담 예약', icon: '📅' },
    { id: 'messages', label: '멘탈케어 메시지', icon: '💬' },
    { id: 'slack',    label: 'Slack 연동',    icon: '🔔' },
  ];

  return (
    <div className="space-y-6">
      {/* 탭 내비게이션 */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.id
                ? 'bg-white border border-b-white border-gray-200 text-blue-700 -mb-px'
                : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className="mr-1.5">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── 상담 예약 탭 ── */}
      {tab === 'bookings' && (
        <section className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-base font-bold text-gray-800">EWS 자동 생성 상담 예약</h2>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'pending', 'confirmed', 'completed', 'cancelled'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setBookingFilter(s)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition
                    ${bookingFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {s === 'all' ? '전체' : STATUS_LABEL[s]}
                </button>
              ))}
              <button
                onClick={() => void refetchBookings()}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
                title="새로고침"
              >
                ↻ 새로고침
              </button>
            </div>
          </div>

          {bookingLoading && (
            <p className="text-sm text-gray-400 py-4 text-center">로딩 중...</p>
          )}
          {bookingError && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg p-3">{bookingError}</p>
          )}
          {!bookingLoading && bookings.length === 0 && !bookingError && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">🎉</p>
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
            <h2 className="text-base font-bold text-gray-800">멘탈케어 안부 메시지</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
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
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
              >
                ↻ 새로고침
              </button>
              {messages.some((m) => !m.isAdminRead) && (
                <button
                  disabled={readAllMutation.isPending}
                  onClick={() => readAllMutation.mutate()}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 transition disabled:opacity-50"
                >
                  전체 읽음 처리
                </button>
              )}
            </div>
          </div>

          {msgLoading && (
            <p className="text-sm text-gray-400 py-4 text-center">로딩 중...</p>
          )}
          {msgError && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg p-3">{msgError}</p>
          )}
          {!msgLoading && messages.length === 0 && !msgError && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">✅</p>
              <p className="font-medium">
                {unreadOnly ? '미확인 메시지가 없습니다.' : '생성된 메시지가 없습니다.'}
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
          <h2 className="text-base font-bold text-gray-800">Slack Webhook 연동 테스트</h2>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
            <p className="font-semibold">Slack Webhook URL 설정 안내</p>
            <p>
              Slack Webhook URL은 <strong>보안 키 관리</strong> 탭에서{' '}
              <code className="bg-blue-100 px-1 rounded">slackWebhookUrl</code> 키로 등록하세요.
            </p>
            <p className="text-xs text-blue-600">
              EWS 위험 점수 60점 이상 수강생 감지 시 자동으로 발송됩니다.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-gray-700">에스컬레이션 정책</p>
              <ul className="text-sm text-gray-600 space-y-1 list-none">
                <li><span className="inline-block w-5 mr-1">⚠️</span>60~74점 — 담당 강사 채널 알림</li>
                <li><span className="inline-block w-5 mr-1">🔴</span>75~89점 — 강사 + 원장 채널 + 멘탈케어 메시지</li>
                <li><span className="inline-block w-5 mr-1">🚨</span>90~100점 — 전 단계 + 상담 예약 자동 생성</li>
              </ul>
            </div>

            <hr className="border-gray-100" />

            <div className="flex items-center gap-3">
              <button
                disabled={slackMutation.isPending}
                onClick={() => { setSlackResult(null); slackMutation.mutate(); }}
                className="px-4 py-2 bg-[#4A154B] text-white text-sm font-medium rounded-lg hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2"
              >
                {slackMutation.isPending ? (
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <span>⚡</span>
                )}
                Slack 테스트 메시지 발송
              </button>

              {slackResult && (
                <p className={`text-sm font-medium ${slackResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {slackResult.ok ? '✅ ' : '❌ '}{slackResult.msg}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
