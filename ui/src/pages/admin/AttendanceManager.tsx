/**
 * 출결 관리 — 강사/관리자 전용
 *
 * 기능:
 * - 과목 선택 →  주차×회차 그리드 (수강생 세로, 주차/회차 가로)
 * - 셀 클릭으로 O/X/L/A 직접 입력 (강사 직접 체크)
 * - 출석 세션 열기/닫기
 * - QR 코드 생성 (5분 유효)
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { QRCodeSVG } from 'qrcode.react';
import {
  QrCode, Play, Square, RefreshCw, CalendarCheck,
  X, Users,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL ?? '/api';

type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

interface Course {
  id: string; name: string; subject: string;
}
interface StudentItem {
  id: string; displayName: string | null; email: string | null;
}
interface SessionItem {
  id: string; weekNo: number; sessionNo: number; sessionDate: string; isOpen: boolean;
  openedAt: string; closedAt: string | null;
}
interface MatrixData {
  course: Course;
  students: StudentItem[];
  sessions: SessionItem[];
  records: Record<string, Record<string, { status: AttendanceStatus; method: string }>>;
}
interface QrData {
  qr: { id: string; token: string; expiresAt: string };
  verifyUrl: string;
  expiresAt: string;
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'O', absent: 'X', late: 'L', excused: 'A',
};
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  absent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  late: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  excused: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};
const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

function nextStatus(cur: AttendanceStatus | undefined): AttendanceStatus {
  const idx = cur ? STATUS_CYCLE.indexOf(cur) : -1;
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]!;
}

// QR 타이머 컴포넌트
function QrTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const pct = (remaining / 300) * 100;
  const color = remaining > 60 ? 'bg-green-500' : remaining > 20 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>QR 유효 시간</span>
        <span className="font-mono">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>
      </div>
      <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-1000 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AttendanceManager() {
  const token = localStorage.getItem('openmento_token') ?? '';
  const qc = useQueryClient();

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<SessionItem | null>(null);
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [newWeek, setNewWeek] = useState(1);
  const [newSession, setNewSession] = useState(1);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));

  // 과목 목록 조회
  const coursesQuery = useQuery<{ courses: Course[] }>({
    queryKey: ['attendance-courses'],
    queryFn: async () => {
      const res = await fetch(`${API}/instructor/courses`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('과목 목록 조회 실패');
      return res.json();
    },
  });

  // 출결 그리드 조회
  const matrixQuery = useQuery<MatrixData>({
    queryKey: ['attendance-matrix', selectedCourseId],
    enabled: Boolean(selectedCourseId),
    queryFn: async () => {
      const res = await fetch(`${API}/attendance/courses/${selectedCourseId}/matrix`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('출결 조회 실패');
      return res.json();
    },
  });

  // 열린 세션 감지
  useEffect(() => {
    if (matrixQuery.data) {
      const open = matrixQuery.data.sessions.find((s) => s.isOpen) ?? null;
      setOpenSession(open);
    }
  }, [matrixQuery.data]);

  // 세션 열기
  const openSessionMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/attendance/courses/${selectedCourseId}/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekNo: newWeek, sessionNo: newSession, sessionDate }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? '세션 열기 실패');
      }
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedCourseId] }),
  });

  // 세션 닫기
  const closeSessionMut = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`${API}/attendance/sessions/${sessionId}/close`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('세션 닫기 실패');
      return res.json();
    },
    onSuccess: () => {
      setQrData(null);
      void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedCourseId] });
    },
  });

  // 단일 셀 직접 입력
  const manualMut = useMutation({
    mutationFn: async ({
      sessionId, studentId, status,
    }: { sessionId: string; studentId: string; status: AttendanceStatus }) => {
      const res = await fetch(`${API}/attendance/sessions/${sessionId}/manual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ studentId, status }] }),
      });
      if (!res.ok) throw new Error('출결 입력 실패');
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['attendance-matrix', selectedCourseId] }),
  });

  // QR 생성
  const genQrMut = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`${API}/attendance/sessions/${sessionId}/qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('QR 생성 실패');
      return res.json() as Promise<QrData>;
    },
    onSuccess: (data) => {
      setQrData(data);
      setShowQrModal(true);
    },
  });

  const matrix = matrixQuery.data;

  // 주차×회차 헤더 목록 (표시된 세션들 + 현재 새 세션 포함)
  const sessionHeaders = matrix?.sessions ?? [];

  const handleCellClick = (sessionId: string, studentId: string, curStatus: AttendanceStatus | undefined) => {
    const next = nextStatus(curStatus);
    manualMut.mutate({ sessionId, studentId, status: next });
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
          <CalendarCheck size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">출결 관리</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400"></p>
        </div>
      </div>

      {/* 과목 선택 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">과목 선택</label>
        {coursesQuery.isLoading ? (
          <div className="text-sm text-gray-500">로딩 중...</div>
        ) : (
          <select
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            value={selectedCourseId ?? ''}
            onChange={(e) => setSelectedCourseId(e.target.value || null)}
          >
            <option value="">-- 과목을 선택하세요 --</option>
            {(coursesQuery.data?.courses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.subject})</option>
            ))}
          </select>
        )}
      </div>

      {selectedCourseId && (
        <>
          {/* 세션 컨트롤 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">주차</label>
                <input
                  type="number" min={1} max={52} value={newWeek}
                  onChange={(e) => setNewWeek(Number(e.target.value))}
                  className="w-20 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">회차</label>
                <input
                  type="number" min={1} max={20} value={newSession}
                  onChange={(e) => setNewSession(Number(e.target.value))}
                  className="w-20 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">날짜</label>
                <input
                  type="date" value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <button
                onClick={() => openSessionMut.mutate()}
                disabled={openSessionMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium disabled:opacity-50"
              >
                <Play size={14} />
                {openSession ? '재개/변경' : '출석 세션 열기'}
              </button>
              {openSession && (
                <>
                  <button
                    onClick={() => genQrMut.mutate(openSession.id)}
                    disabled={genQrMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg font-medium disabled:opacity-50"
                  >
                    <QrCode size={14} />
                    QR 생성
                  </button>
                  <button
                    onClick={() => closeSessionMut.mutate(openSession.id)}
                    disabled={closeSessionMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-medium disabled:opacity-50"
                  >
                    <Square size={14} />
                    세션 닫기
                  </button>
                </>
              )}
            </div>
            {openSession && (
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  {openSession.weekNo}주차 {openSession.sessionNo}회차 출석 진행 중
                </span>
              </div>
            )}
          </div>

          {/* 출결 그리드 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {matrixQuery.isLoading ? (
              <div className="flex items-center justify-center h-40 text-sm text-gray-500">
                <RefreshCw size={16} className="animate-spin mr-2" /> 로딩 중...
              </div>
            ) : !matrix ? null : matrix.students.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-sm text-gray-500 gap-2">
                <Users size={24} />
                등록된 수강생이 없습니다.
              </div>
            ) : (
              <div className="overflow-auto max-h-[520px]">
                <table className="min-w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700/80 z-10">
                    <tr>
                      <th className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-700/80 px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 min-w-[120px]">
                        수강생
                      </th>
                      {sessionHeaders.map((s) => (
                        <th
                          key={s.id}
                          className={`px-2 py-2 text-center font-semibold border-b border-gray-200 dark:border-gray-600 min-w-[56px] ${
                            s.isOpen
                              ? 'text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20'
                              : 'text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          <div>{s.weekNo}주</div>
                          <div className="font-normal text-gray-500 dark:text-gray-400">{s.sessionNo}회</div>
                          {s.isOpen && (
                            <div className="text-[9px] text-green-600 dark:text-green-400">● 진행</div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.students.map((student, rowIdx) => (
                      <tr
                        key={student.id}
                        className={rowIdx % 2 === 0
                          ? 'bg-white dark:bg-gray-800'
                          : 'bg-gray-50/50 dark:bg-gray-700/30'}
                      >
                        <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium text-gray-800 dark:text-gray-200 border-b border-gray-100 dark:border-gray-700 truncate max-w-[140px]">
                          {student.displayName ?? student.email ?? student.id.slice(0, 8)}
                        </td>
                        {sessionHeaders.map((sess) => {
                          const key = `${sess.weekNo}_${sess.sessionNo}`;
                          const rec = matrix.records[student.id]?.[key];
                          const status = rec?.status;
                          const isClickable = sess.isOpen;
                          return (
                            <td
                              key={sess.id}
                              className={`px-1 py-1.5 text-center border-b border-gray-100 dark:border-gray-700 ${
                                isClickable ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20' : ''
                              }`}
                              onClick={() => isClickable && handleCellClick(sess.id, student.id, status)}
                              title={isClickable ? '클릭하여 출결 변경' : rec?.method ?? ''}
                            >
                              {status ? (
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-bold text-xs ${STATUS_COLOR[status]}`}>
                                  {STATUS_LABEL[status]}
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-gray-300 dark:text-gray-600">
                                  –
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
            {STATUS_CYCLE.map((s) => (
              <span key={s} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${STATUS_COLOR[s]}`}>
                <span className="font-bold">{STATUS_LABEL[s]}</span>
                {s === 'present' ? '출석' : s === 'absent' ? '결석' : s === 'late' ? '지각' : '공결'}
              </span>
            ))}
            <span className="text-gray-400 dark:text-gray-500 ml-2">* 활성 세션 셀 클릭 시 순환 변경</span>
          </div>
        </>
      )}

      {/* QR 모달 */}
      {showQrModal && qrData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-80 flex flex-col items-center gap-4">
            <div className="flex items-center justify-between w-full">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <QrCode size={16} className="text-indigo-500" />
                QR 출석 코드
              </h3>
              <button onClick={() => setShowQrModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>
            <div className="p-3 bg-white rounded-xl border border-gray-200">
              <QRCodeSVG value={qrData.verifyUrl} size={200} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              수강생이 이 QR을 스캔하면 자동으로 출석 처리됩니다.
            </p>
            <QrTimer expiresAt={qrData.expiresAt} />
            <button
              onClick={() => genQrMut.mutate(openSession!.id)}
              disabled={genQrMut.isPending}
              className="w-full flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg font-medium"
            >
              <RefreshCw size={14} />
              QR 재생성
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
