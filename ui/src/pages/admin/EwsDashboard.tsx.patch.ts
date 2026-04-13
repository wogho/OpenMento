import * as fs from 'fs';
const file = '/workspaces/codespaces-blank/openmento_stage/ui/src/pages/admin/EwsDashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// We will change `type EwsTab = 'bookings' | 'mental-care';` to include it inside Openmento tab.
// And we add a parent tab: type MainEwsTab = 'openmento' | 'lms';
// Let's just create a completely new file structure that imports the old EwsDashboard and puts it in Openmento Ews tab. Wait, it's easier to just modify the file.

content = content.replace(
  `export default function EwsDashboard() {`,
  `type MainEwsTab = 'openmento' | 'lms';\n\nexport default function EwsDashboard() {\n  const [mainTab, setMainTab] = useState<MainEwsTab>('openmento');\n  const [lmsMode, setLmsMode] = useState<'api'|'db'>('api');\n  const [lmsConnected, setLmsConnected] = useState(false);\n  const [syncAttendance, setSyncAttendance] = useState(false);\n`
);

// We find the `return (` block.
const returnIndex = content.indexOf('  return (');
if (returnIndex !== -1) {
  content = content.slice(0, returnIndex) + `
  return (
    <div className="space-y-6">
      {/* ── 통합 EWS 메인 탭 ── */}
      <div className="flex items-center gap-6 border-b border-gray-200 pb-2">
        <button
          onClick={() => setMainTab('openmento')}
          className={\`pb-3 text-lg font-bold transition-all border-b-2 \${
            mainTab === 'openmento'
              ? 'text-blue-600 border-blue-600'
              : 'text-gray-400 border-transparent hover:text-gray-600'
          }\`}
        >
          OpenMento EWS
        </button>
        <button
          onClick={() => setMainTab('lms')}
          className={\`pb-3 text-lg font-bold transition-all border-b-2 \${
            mainTab === 'lms'
              ? 'text-blue-600 border-blue-600'
              : 'text-gray-400 border-transparent hover:text-gray-600'
          }\`}
        >
          LMS EWS 연동
        </button>
      </div>

      {mainTab === 'openmento' ? (
        <div className="space-y-6">
` + content.slice(returnIndex + 11).replace(/ {4}<\/div>\n {2}\);\n}/, `        </div>\n      ) : (\n        <div className="space-y-6 bg-white rounded-2xl shadow-sm p-8">\n          <h2 className="text-xl font-bold text-gray-800">LMS API/DB 연동 설정</h2>\n          <p className="text-sm text-gray-500">\n            외부 시스템의 출결, 성적, 진도율 데이터를 가져와 통합 EWS 분석을 수행합니다.\n          </p>\n\n          <div className="flex items-center gap-4 mt-4">\n            <label className="flex items-center gap-2 cursor-pointer">\n              <input type="radio" value="api" checked={lmsMode === 'api'} onChange={() => setLmsMode('api')} /> API (Webhook) 기반\n            </label>\n            <label className="flex items-center gap-2 cursor-pointer">\n              <input type="radio" value="db" checked={lmsMode === 'db'} onChange={() => setLmsMode('db')} /> DB 연결 기반\n            </label>\n          </div>\n\n          {lmsMode === 'api' && (\n            <div className="bg-gray-50 p-4 rounded-xl text-sm text-gray-700 space-y-2">\n              <p>LMS 시스템에서 다음 엔드포인트로 데이터를 PUSH 하십시오:</p>\n              <code className="block bg-gray-900 text-green-400 p-2 rounded">POST {API_BASE}/lms-webhook/attendance</code>\n              <p>헤더에 HMAC-SHA256 <code>x-signature-256</code> 서명을 포함해야 합니다.</p>\n            </div>\n          )}\n          {lmsMode === 'db' && (\n            <div className="space-y-4">\n              <div className="grid grid-cols-2 gap-4">\n                <input type="text" placeholder="DB Host (단방향 IP)" className="border p-2 rounded-xl text-sm" />\n                <input type="text" placeholder="DB Port" className="border p-2 rounded-xl text-sm" />\n                <input type="text" placeholder="DB Username" className="border p-2 rounded-xl text-sm" />\n                <input type="password" placeholder="DB Password" className="border p-2 rounded-xl text-sm" />\n              </div>\n              <p className="text-xs text-red-500">* 보안을 위해 방화벽(IP 192.168.x.x)이 허용된 사설망에서만 접근이 가능합니다.</p>\n            </div>\n          )}\n\n          <div className="flex items-center gap-4 pt-4 border-t border-gray-100">\n            <button\n              onClick={() => setLmsConnected(!lmsConnected)}\n              className={\`px-6 py-2 rounded-xl font-bold text-sm transition-colors \${lmsConnected ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-600 text-white hover:bg-blue-700'}\`}\n            >\n              {lmsConnected ? '연결 해제' : '연결 테스트 & 저장'}\n            </button>\n            {lmsConnected && <span className="text-sm text-green-600 font-bold">● 연결 확인됨</span>}\n          </div>\n\n          <div className={\`mt-6 p-4 rounded-xl border \${lmsConnected ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-gray-50 opacity-50 pointer-events-none'}\`}>\n            <div className="flex items-center justify-between">\n              <div>\n                <h3 className="font-bold text-gray-800">출결 연동 동기화 활성화</h3>\n                <p className="text-xs text-gray-500 mt-1">LMS의 출결 데이터를 실시간으로 가져와 EWS 점수에 반영합니다.</p>\n              </div>\n              <label className="relative inline-flex items-center cursor-pointer">\n                <input type="checkbox" className="sr-only peer" checked={syncAttendance} onChange={(e) => setSyncAttendance(e.target.checked)} disabled={!lmsConnected} />\n                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>\n              </label>\n            </div>\n          </div>\n        </div>\n      )}\n    </div>\n  );\n}\n`);
}

fs.writeFileSync(file, content);
