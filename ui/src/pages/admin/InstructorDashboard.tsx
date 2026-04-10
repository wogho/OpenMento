/**
 * 강사 대시보드 — 수강생 현황 + EWS 위험 목록 (데이터 페칭 + 레이아웃만 담당)
 *
 * 개선 ④: 컴포넌트 분리 — StudentRow, EwsRiskCard 가 ui/components/dashboard/ 로 이동
 * GET /instructor/students  — 수강생 현황 (?limit=20&offset=0)
 * GET /instructor/ews       — 위험 수강생 목록
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { StudentRow } from '../../components/dashboard/StudentRow';
import { EwsRiskCard } from '../../components/dashboard/EwsRiskCard';
import type { StudentPage } from '../../components/dashboard/StudentRow';
import type { EwsStudent } from '../../components/dashboard/EwsRiskCard';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const PAGE_SIZE = 20;

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
            {tab === 'students' ? ' 수강생 현황' : '️ 위험 수강생'}
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
               현재 위험 수강생이 없습니다.
            </div>
          )}
          {ewsQuery.data?.map((s) => (
            <EwsRiskCard key={s.scoreId} student={s} token={token ?? ''} onActionDone={handleActionDone} />
          ))}
        </div>
      )}
    </div>
  );
}
