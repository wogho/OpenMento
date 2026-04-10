import fs from 'fs';
const path = './src/pages/ChatPage.tsx';
let txt = fs.readFileSync(path, 'utf8');

// Replace simple alert or console errors (if any) with toast
txt = txt.replace(/console\.error\('Failed to send message:', err\);/g, "console.error('Failed to send message:', err);\n      toast.error('메시지 전송에 실패했습니다.');");

txt = txt.replace(/console\.error\('Failed to disconnect:', err\);/g, "console.error('Failed to disconnect:', err);\n      toast.error('채팅 종료 중 오류가 발생했습니다.');");

// Add haptic toast for success if we want, maybe on reset.
txt = txt.replace(/await resetSession\(\);/g, "await resetSession();\n      toast.success('새로운 대화를 시작합니다. ✨');");

fs.writeFileSync(path, txt);
