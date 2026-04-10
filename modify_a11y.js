import fs from 'fs';

// 1. PortfolioPage.tsx
const pfile = './ui/src/pages/PortfolioPage.tsx';
let ptxt = fs.readFileSync(pfile, 'utf8');

ptxt = ptxt.replace(/<span className="text-lg font-bold text-gray-800">📋 포트폴리오 기획서<\/span>/, 
  "<h1 className=\"text-lg font-bold text-gray-800\" aria-live=\"polite\">📋 포트폴리오 기획서</h1>");

ptxt = ptxt.replace(/<div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">/, 
  "<div className=\"flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700\" role=\"alert\" aria-live=\"assertive\">");

fs.writeFileSync(pfile, ptxt);

// 2. ChatPage.tsx
const cfile = './ui/src/pages/ChatPage.tsx';
let ctxt = fs.readFileSync(cfile, 'utf8');

ctxt = ctxt.replace(/<Virtuoso/, "<Virtuoso aria-label=\"채팅 메시지 목록\"");
ctxt = ctxt.replace(/<div className="h-full flex flex-col pt-14 bg-\[\#f8f9fa\]">/, "<main className=\"h-full flex flex-col pt-14 bg-[#f8f9fa]\" role=\"main\">");
ctxt = ctxt.replace(/<\/div>\n    <\/ChatErrorBoundary>/, "</main>\n    </ChatErrorBoundary>");
fs.writeFileSync(cfile, ctxt);

