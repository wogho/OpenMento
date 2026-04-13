import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/apiFetch';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export default function StudentSkillModal({ student, onClose }: { student: { id: string; displayName: string }, onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selectedSkill, setSelectedSkill] = useState('');

  // 전체 스킬 목록 (선택용)
  const { data: allSkills, isLoading: loadingSkills } = useQuery({
    queryKey: ['adminSkills'],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/skills`);
      if (!res.ok) throw new Error('Failed to fetch skills');
      const data = await res.json();
      return data.skills as { id: string; title: string }[];
    },
  });

  // 해당 학생에게 할당된 스킬 목록
  const { data: studentSkills, isLoading: loadingBindings } = useQuery({
    queryKey: ['studentSkills', student.id],
    queryFn: async () => {
      const res = await apiFetch(`${API_BASE}/admin/students/${student.id}/skills`);
      if (!res.ok) throw new Error('Failed to fetch student skills');
      const data = await res.json();
      return data.bindings as { id: string; skillId: string; skillTitle: string }[];
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const res = await apiFetch(`${API_BASE}/admin/students/${student.id}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to assign skill');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentSkills', student.id] });
      setSelectedSkill('');
      toast.success('스킬이 할당되었습니다.');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  const unassignMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const res = await apiFetch(`${API_BASE}/admin/students/${student.id}/skills/${skillId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to unassign skill');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentSkills', student.id] });
      toast.success('스킬 할당이 해제되었습니다.');
    },
  });

  const handleAssign = () => {
    if (!selectedSkill) return;
    assignMutation.mutate(selectedSkill);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg p-6 relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
          <X size={20} />
        </button>
        
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          {student.displayName || '이름없음'} 스킬 매핑
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
          해당 수강생의 AI 튜터에게 주입될 맞춤형 교재/상황별 스킬을 설정합니다.
        </p>

        <div className="space-y-4">
          {/* 할당 폼 */}
          <div className="flex gap-2">
            <select
              value={selectedSkill}
              onChange={(e) => setSelectedSkill(e.target.value)}
              className="flex-1 p-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              disabled={loadingSkills}
            >
              <option value="">스킬을 선택하세요...</option>
              {allSkills?.map(s => (
                <option key={s.id} value={s.id} disabled={studentSkills?.some(b => b.skillId === s.id)}>
                  {s.title} {studentSkills?.some(b => b.skillId === s.id) ? '(이미 할당됨)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={handleAssign}
              disabled={!selectedSkill || assignMutation.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-1 transition-colors"
            >
              {assignMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              추가
            </button>
          </div>

          {/* 할당된 목록 */}
          <div className="pt-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">할당된 스킬 프롬프트</h3>
            {loadingBindings ? (
              <div className="py-4 text-center text-sm text-gray-500"><Loader2 size={16} className="animate-spin inline mr-2" />불러오는 중...</div>
            ) : studentSkills?.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-slate-700 rounded-lg">
                할당된 맞춤 스킬이 없습니다. (에이전트 기본 스킬만 적용됩니다)
              </div>
            ) : (
              <ul className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {studentSkills?.map(binding => (
                  <li key={binding.id} className="flex justify-between items-center p-3 text-sm bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-600 rounded-lg">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{binding.skillTitle}</span>
                    <button
                      onClick={() => unassignMutation.mutate(binding.skillId)}
                      disabled={unassignMutation.isPending}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      title="할당 해제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
