import fs from 'fs';
const path = './src/pages/admin/PrincipalDashboard.tsx';
let txt = fs.readFileSync(path, 'utf8');

if (!txt.includes('import { AreaChart')) {
  txt = txt.replace(
    /import { useAuth } from '\.\.\/\.\.\/hooks\/useAuth';/,
    `import { useAuth } from '../../hooks/useAuth';\nimport { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';`
  );

  const chartsHtml = `
      {/* ── 데이터 시각화 (Recharts) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EWS 위험도 트렌드 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-[360px]">
          <h2 className="text-base font-bold text-gray-800 mb-4 h-6">📈 최근 6개월 EWS 위험도 트렌드</h2>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={[
                  { name: '10월', highRisk: 4, atRisk: 12 },
                  { name: '11월', highRisk: 5, atRisk: 14 },
                  { name: '12월', highRisk: 3, atRisk: 10 },
                  { name: '1월', highRisk: 7, atRisk: 18 },
                  { name: '2월', highRisk: 6, atRisk: 15 },
                  { name: '3월', highRisk: data.atRiskCount, atRisk: 12 },
                ]}
                margin={{ top: 10, right: 30, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorHighRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAtRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#374151', marginBottom: '4px' }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Area type="monotone" dataKey="atRisk" name="관심 분류" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorAtRisk)" />
                <Area type="monotone" dataKey="highRisk" name="고위험군" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorHighRisk)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 학생별 출결 분포 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col h-[360px]">
          <h2 className="text-base font-bold text-gray-800 mb-4 h-6">📊 주간 출결 분포 현황</h2>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: '월', present: 45, absent: 2, late: 3 },
                  { name: '화', present: 48, absent: 0, late: 2 },
                  { name: '수', present: 42, absent: 5, late: 3 },
                  { name: '목', present: 46, absent: 1, late: 3 },
                  { name: '금', present: 40, absent: 4, late: 6 },
                ]}
                margin={{ top: 10, right: 30, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  cursor={{ fill: '#f3f4f6' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#374151', marginBottom: '4px' }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="present" name="정상 출석" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                <Bar dataKey="late" name="지각/조퇴" stackId="a" fill="#fbbf24" />
                <Bar dataKey="absent" name="결석" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>\n\n      {/* 위험 수강생 목록 */}`;

  txt = txt.replace(
    /\{\/\* 위험 수강생 목록 \*\/\}/,
    chartsHtml
  );
  
  fs.writeFileSync(path, txt);
}
