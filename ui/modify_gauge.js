import fs from 'fs';
const path = './src/components/portfolio/OriginalityGauge.tsx';
let txt = fs.readFileSync(path, 'utf8');

if (!txt.includes('import { Radar')) {
  txt = txt.replace(
    /export type SimilarityVerdict/,
    `import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';\n\nexport type SimilarityVerdict`
  );

  const radarChartStr = `
      {/* 레이더 차트 (Network/Radar Graph 시각화) */}
      <div className="h-[240px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={[
            { subject: '주제/도메인', A: Math.min(originalityPct + 10, 100), fullMark: 100 },
            { subject: '문제정의', A: Math.max(originalityPct - 5, 0), fullMark: 100 },
            { subject: '솔루션 차별성', A: originalityPct, fullMark: 100 },
            { subject: '기술스택/접근', A: Math.min(originalityPct + 15, 100), fullMark: 100 },
            { subject: '기대효과', A: Math.max(originalityPct - 10, 0), fullMark: 100 },
          ]}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: '#4b5563', fontSize: 11 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              itemStyle={{ color: '#4338ca', fontWeight: 'bold' }}
            />
            <Radar name="독창성 지수" dataKey="A" stroke="#6366f1" fill="#818cf8" fillOpacity={0.5} />
          </RadarChart>
        </ResponsiveContainer>
      </div>\n    </div>\n  );\n}`;

  txt = txt.replace(
    /    <\/div>\n  \);\n\}/,
    radarChartStr
  );
  
  fs.writeFileSync(path, txt);
}
