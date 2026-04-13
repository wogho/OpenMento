import { useState, useEffect } from 'react';
import { Building2, Plus } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

export default function InstitutionManagement() {
  const { user, loginWithToken } = useAuth();
  const [institutions, setInstitutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/super-admin/institutions', {
      headers: { Authorization: `Bearer ${localStorage.getItem('openmento_token')}` },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setInstitutions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const switchInstitution = async (id: string) => {
    try {
      const res = await fetch('/api/auth/switch-institution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('openmento_token')}`
        },
        body: JSON.stringify({ targetInstitutionId: id })
      });
      if (res.ok) {
        const { token } = await res.json();
        loginWithToken(token);
        window.location.reload();
      } else {
        alert('기관 전환 실패');
      }
    } catch (e) {
      alert('오류 발생');
    }
  };

  if (user?.role !== 'admin') {
    return <div className="p-6">Admin 권한이 필요합니다.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="text-blue-600" /> 기관(Tenant) 관리
        </h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2 hover:bg-blue-700">
          <Plus size={16} /> 신규 기관 생성
        </button>
      </div>

      {loading ? (
        <div>로딩 중...</div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 font-medium text-gray-500">기관명</th>
                <th className="px-6 py-3 font-medium text-gray-500">상태</th>
                <th className="px-6 py-3 font-medium text-gray-500">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {institutions.map(inst => (
                <tr key={inst.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium">{inst.name}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs ${inst.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {inst.isActive ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="px-6 py-4 flex items-center gap-2">
                    <button
                      onClick={() => switchInstitution(inst.id)}
                      className={`px-3 py-1 text-sm border rounded hover:bg-gray-100 ${user.institutionId === inst.id ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}`}
                      disabled={user.institutionId === inst.id}
                    >
                      {user.institutionId === inst.id ? '현재 접속 중' : '전환하기'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
