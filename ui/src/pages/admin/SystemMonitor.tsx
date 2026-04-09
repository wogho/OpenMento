/**
 * SystemMonitor.tsx — 시스템 상태 모니터링 대시보드 (Phase 5-4)
 *
 * ── 기능 ──────────────────────────────────────────────────────────────────────
 *
 *   1. 서비스 상태 카드  — API Server / DB / Redis / AI Scheduler 실시간 헬스 표시
 *   2. 에이전트 실행 현황— heartbeat_runs 최근 실행을 WebSocket으로 실시간 업데이트
 *   3. "로그 보기" 버튼 — stdoutExcerpt 모달 표시
 *   4. "재시작" 버튼    — 확인 다이얼로그 후 POST /admin/system/restart
 *
 * ── WebSocket 이벤트 ──────────────────────────────────────────────────────────
 *
 *   agent:status_change  { agentId, agentName, runId, status, finishedAt, errorMessage? }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io as ioConnect, type Socket } from 'socket.io-client';
import { useAuth } from '../../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ── 타입 ──────────────────────────────────────────────────────────────────────

type ServiceStatus = 'ok' | 'degraded' | 'down' | 'unavailable' | 'stopped';

interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  latencyMs: number | null;
  detail?: string;
}

interface SystemStatusResult {
  services: ServiceInfo[];
  uptime: number;
  memoryMb: number;
  timestamp: string;
}

interface AgentRow {
  agentId: string;
  agentName: string;
  role: string;
  isActive: boolean;
  runId: string | null;
  runStatus: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  stdoutExcerpt: string | null;
}

interface RunRow {
  id: string;
  agentId: string | null;
  agentName: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  stdoutExcerpt: string | null;
  resultJson: unknown;
  createdAt: string;
}

interface StatusChangePayload {
  agentId: string;
  agentName: string;
  runId: string;
  status: string;
  finishedAt: string;
  errorMessage?: string;
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function statusColor(status: ServiceStatus | string): string {
  switch (status) {
    case 'ok':        return 'bg-green-100 text-green-700 border-green-200';
    case 'degraded':  return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'down':      return 'bg-red-100 text-red-700 border-red-200';
    case 'stopped':   return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'unavailable': return 'bg-gray-100 text-gray-500 border-gray-200';
    default:          return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function statusDot(status: ServiceStatus | string): string {
  switch (status) {
    case 'ok':        return 'bg-green-400 animate-pulse';
    case 'degraded':  return 'bg-yellow-400 animate-pulse';
    case 'down':      return 'bg-red-500 animate-pulse';
    case 'stopped':   return 'bg-orange-400';
    default:          return 'bg-gray-300';
  }
}

function statusLabel(status: ServiceStatus | string): string {
  switch (status) {
    case 'ok':          return '정상';
    case 'degraded':    return '성능 저하';
    case 'down':        return '다운';
    case 'stopped':     return '중지됨';
    case 'unavailable': return '미사용';
    default:            return status;
  }
}

function runStatusBadge(status: string | null | undefined): string {
  switch (status) {
    case 'completed': return 'bg-green-100 text-green-700';
    case 'running':   return 'bg-blue-100 text-blue-700 animate-pulse';
    case 'wakeup':    return 'bg-yellow-100 text-yellow-700 animate-pulse';
    case 'queued':    return 'bg-purple-100 text-purple-700';
    case 'failed':    return 'bg-red-100 text-red-700';
    default:          return 'bg-gray-100 text-gray-500';
  }
}

function runStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'completed': return '완료';
    case 'running':   return '실행 중';
    case 'wakeup':    return '기상 중';
    case 'queued':    return '대기 중';
    case 'failed':    return '실패';
    default:          return '미실행';
  }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '-';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

// ── 서비스 상태 카드 ──────────────────────────────────────────────────────────

function ServiceCard({ info }: { info: ServiceInfo }) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${statusColor(info.status)}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusDot(info.status)}`} />
        <span className="font-semibold text-sm">{info.name}</span>
      </div>
      <div className="text-lg font-bold">{statusLabel(info.status)}</div>
      {info.latencyMs !== null && (
        <div className="text-xs opacity-70">응답: {info.latencyMs}ms</div>
      )}
      {info.detail && (
        <div className="text-xs opacity-60 truncate" title={info.detail}>{info.detail}</div>
      )}
    </div>
  );
}

// ── 로그 보기 모달 ─────────────────────────────────────────────────────────────

function LogModal({
  log,
  agentName,
  onClose,
}: {
  log: string;
  agentName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[680px] max-w-[95vw] max-h-[75vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <div className="font-semibold text-gray-800">실행 로그</div>
            <div className="text-xs text-gray-400 mt-0.5">{agentName}</div>
          </div>
          <button className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition" onClick={onClose}>
            ✕
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-5 text-xs font-mono text-gray-700 bg-gray-50 whitespace-pre-wrap leading-relaxed">
          {log || '(로그 없음)'}
        </pre>
      </div>
    </div>
  );
}

// ── 재시작 확인 모달 ──────────────────────────────────────────────────────────

function RestartConfirmModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[420px] max-w-[95vw] p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">⚠️</span>
          <div>
            <div className="font-bold text-gray-800">서비스 재시작 확인</div>
            <div className="text-sm text-gray-500 mt-1">
              API 서버가 약 5〜10초간 일시 중단됩니다. Docker 재시작 정책에 의해 자동으로 재기동됩니다.
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
            onClick={onClose}
          >
            취소
          </button>
          <button
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition"
            onClick={onConfirm}
          >
            재시작
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function SystemMonitor() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const [logModal, setLogModal] = useState<{ log: string; agentName: string } | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [recentEvents, setRecentEvents] = useState<StatusChangePayload[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // ── API 요청 헬퍼 ───────────────────────────────────────
  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${token ?? ''}`,
    'Content-Type': 'application/json',
  }), [token]);

  // ── 서비스 상태 폴링 (30초마다 자동 갱신) ───────────────
  const { data: sysStatus, isLoading: sysLoading, refetch: refetchStatus } = useQuery<SystemStatusResult>({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/system/status`, { headers: authHeaders() });
      if (!res.ok) throw new Error('상태 조회 실패');
      return res.json() as Promise<SystemStatusResult>;
    },
    refetchInterval: 30_000,
  });

  // ── 에이전트 실행 상태 조회 ──────────────────────────────
  const { data: agentRows, refetch: refetchAgents } = useQuery<AgentRow[]>({
    queryKey: ['system-agents'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/admin/system/agents`, { headers: authHeaders() });
      if (!res.ok) throw new Error('에이전트 상태 조회 실패');
      return res.json() as Promise<AgentRow[]>;
    },
    refetchInterval: 30_000,
  });

  // ── 최근 실행 이력 (상세 로그 포함) ─────────────────────
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const { data: runRows, refetch: refetchRuns } = useQuery<RunRow[]>({
    queryKey: ['system-runs', selectedAgentId],
    queryFn: async () => {
      const url = selectedAgentId
        ? `${API_BASE}/admin/system/runs?limit=20&agentId=${selectedAgentId}`
        : `${API_BASE}/admin/system/runs?limit=20`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error('실행 이력 조회 실패');
      return res.json() as Promise<RunRow[]>;
    },
  });

  // ── 서비스 재시작 Mutation ───────────────────────────────
  const restartMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/admin/system/restart`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('재시작 요청 실패');
      return res.json() as Promise<{ message: string }>;
    },
    onSuccess: () => {
      setShowRestartConfirm(false);
    },
  });

  // ── WebSocket: agent:status_change 실시간 수신 ──────────
  useEffect(() => {
    if (!token) return;

    const socket = ioConnect('/', {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('agent:status_change', (payload: StatusChangePayload) => {
      setRecentEvents((prev) => [payload, ...prev].slice(0, 20));
      // 에이전트·실행이력 쿼리 무효화 → 자동 재조회
      void queryClient.invalidateQueries({ queryKey: ['system-agents'] });
      void queryClient.invalidateQueries({ queryKey: ['system-runs'] });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, queryClient]);

  const handleRefreshAll = useCallback(() => {
    void refetchStatus();
    void refetchAgents();
    void refetchRuns();
  }, [refetchStatus, refetchAgents, refetchRuns]);

  // ── 전체 서비스 가중치 색상 ──────────────────────────────
  const overallStatus: ServiceStatus = (() => {
    if (!sysStatus) return 'unavailable';
    const statuses = sysStatus.services.map((s) => s.status);
    if (statuses.includes('down')) return 'down';
    if (statuses.includes('degraded') || statuses.includes('stopped')) return 'degraded';
    return 'ok';
  })();

  return (
    <div className="space-y-6">
      {/* ── 헤더 ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">시스템 상태 모니터링</h2>
          {sysStatus && (
            <p className="text-xs text-gray-400 mt-0.5">
              마지막 갱신: {new Date(sysStatus.timestamp).toLocaleTimeString('ko-KR')} &middot;
              메모리: {sysStatus.memoryMb} MB &middot;
              업타임: {Math.floor(sysStatus.uptime / 60)}분
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefreshAll}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition flex items-center gap-1.5"
          >
            <span>🔄</span> 새로고침
          </button>
          <button
            onClick={() => setShowRestartConfirm(true)}
            className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600 font-medium hover:bg-red-100 transition flex items-center gap-1.5"
          >
            <span>⚡</span> 서비스 재시작
          </button>
        </div>
      </div>

      {/* ── 전체 상태 배너 ─────────────────────────────────── */}
      <div className={`rounded-xl border px-5 py-4 flex items-center gap-3 ${statusColor(overallStatus)}`}>
        <span className={`inline-block w-3 h-3 rounded-full ${statusDot(overallStatus)}`} />
        <span className="font-bold">
          {overallStatus === 'ok' ? '모든 서비스 정상 운영 중' :
           overallStatus === 'degraded' ? '일부 서비스 주의 필요' :
           overallStatus === 'down' ? '서비스 장애 발생' : '상태 확인 중'}
        </span>
        {recentEvents.length > 0 && (
          <span className="ml-auto text-xs opacity-70">
            최근 이벤트: {recentEvents[0]?.agentName ?? ''} — {runStatusLabel(recentEvents[0]?.status)}
          </span>
        )}
      </div>

      {/* ── 서비스 상태 카드 그리드 ────────────────────────── */}
      {sysLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-gray-50 p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : sysStatus ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {sysStatus.services.map((info) => (
            <ServiceCard key={info.name} info={info} />
          ))}
        </div>
      ) : null}

      {/* ── 에이전트별 실행 현황 테이블 ───────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">에이전트 실행 현황</h3>
            <p className="text-xs text-gray-400 mt-0.5">WebSocket 실시간 업데이트 · 30초 자동 갱신</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-500">실시간 연결 중</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3">에이전트</th>
                <th className="px-5 py-3">역할</th>
                <th className="px-5 py-3">상태</th>
                <th className="px-5 py-3">마지막 실행</th>
                <th className="px-5 py-3">소요 시간</th>
                <th className="px-5 py-3 text-right">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!agentRows || agentRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-gray-400 text-sm">
                    등록된 에이전트가 없습니다.
                  </td>
                </tr>
              ) : (
                agentRows.map((row) => {
                  const isLive = recentEvents.some((e) => e.agentId === row.agentId && ['running', 'wakeup'].includes(e.status));
                  return (
                    <tr
                      key={row.agentId}
                      className={`hover:bg-gray-50 transition ${isLive ? 'bg-blue-50/30' : ''}`}
                    >
                      <td className="px-5 py-3 font-medium text-gray-800 flex items-center gap-2">
                        {isLive && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
                        <span>{row.agentName}</span>
                        {!row.isActive && (
                          <span className="ml-1 text-xs bg-gray-100 text-gray-400 rounded px-1">비활성</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{row.role}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${runStatusBadge(row.runStatus)}`}>
                          {runStatusLabel(row.runStatus)}
                        </span>
                        {row.errorMessage && (
                          <p className="text-xs text-red-500 mt-0.5 truncate max-w-[160px]" title={row.errorMessage}>
                            {row.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{timeAgo(row.finishedAt ?? row.startedAt)}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{formatDuration(row.startedAt, row.finishedAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {row.stdoutExcerpt && (
                            <button
                              className="px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-xs text-gray-600 transition"
                              onClick={() => {
                                setSelectedAgentId(row.agentId);
                                setLogModal({ log: row.stdoutExcerpt!, agentName: row.agentName });
                              }}
                            >
                              로그 보기
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 최근 실행 이력 ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-800 text-sm">최근 실행 이력</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {selectedAgentId ? `선택된 에이전트 필터 중` : '전체 에이전트'}
            </p>
          </div>
          {selectedAgentId && (
            <button
              className="text-xs text-blue-500 hover:underline"
              onClick={() => setSelectedAgentId(null)}
            >
              필터 해제
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3">에이전트</th>
                <th className="px-5 py-3">상태</th>
                <th className="px-5 py-3">시작</th>
                <th className="px-5 py-3">종료</th>
                <th className="px-5 py-3">소요 시간</th>
                <th className="px-5 py-3 text-right">로그</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {!runRows || runRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-gray-400 text-sm">
                    실행 이력이 없습니다.
                  </td>
                </tr>
              ) : (
                runRows.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3 font-medium text-gray-800 text-xs">{run.agentName ?? '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${runStatusBadge(run.status)}`}>
                        {runStatusLabel(run.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{timeAgo(run.startedAt)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{timeAgo(run.finishedAt)}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{formatDuration(run.startedAt, run.finishedAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {run.stdoutExcerpt && (
                        <button
                          className="px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-xs text-gray-600 transition"
                          onClick={() => setLogModal({ log: run.stdoutExcerpt!, agentName: run.agentName ?? '-' })}
                        >
                          로그 보기
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 실시간 이벤트 스트림 ───────────────────────────── */}
      {recentEvents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <h3 className="font-semibold text-gray-800 text-sm">실시간 이벤트 스트림</h3>
            <span className="ml-auto text-xs text-gray-400">{recentEvents.length}개</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
            {recentEvents.map((ev, i) => (
              <div key={`${ev.runId}-${i}`} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${runStatusBadge(ev.status)}`}>
                  {runStatusLabel(ev.status)}
                </span>
                <span className="font-medium text-gray-700">{ev.agentName}</span>
                <span className="text-gray-400 text-xs ml-auto">{timeAgo(ev.finishedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 모달들 ─────────────────────────────────────────── */}
      {logModal && (
        <LogModal
          log={logModal.log}
          agentName={logModal.agentName}
          onClose={() => setLogModal(null)}
        />
      )}

      {showRestartConfirm && (
        <RestartConfirmModal
          onConfirm={() => restartMutation.mutate()}
          onClose={() => setShowRestartConfirm(false)}
        />
      )}

      {restartMutation.isSuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-orange-600 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium animate-fade-in">
          ⚡ 재시작 예약됨 — 잠시 후 자동 재기동됩니다.
        </div>
      )}
    </div>
  );
}
