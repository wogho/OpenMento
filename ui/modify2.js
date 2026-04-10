import fs from 'fs';
const path = './src/pages/PortfolioPage.tsx';
let txt = fs.readFileSync(path, 'utf8');

txt = txt.replace(/setError\('기획서 작성이 완료되어 다음 단계를 진행합니다\.'\);/g, "toast.success('기획서 작성이 완료되어 다음 단계를 진행합니다.');\n      setError(null);");
txt = txt.replace(/setError\(err\.(?:message\|\|)?.*\);/g, "toast.error(err.message || '오류가 발생했습니다.');\n      setError(err.message || '오류가 발생했습니다.');");
// Add toast.success("분석이 완료되었습니다!");
txt = txt.replace(/setPhase\('result'\);/g, "toast.success('분석이 완료되었습니다!');\n      setPhase('result');");
txt = txt.replace(/setPhase\('proposal'\);/g, "toast.success('인터뷰를 마치고 기획서 작성을 시작합니다.');\n      setPhase('proposal');");
txt = txt.replace(/setPhase\('interview'\);/g, "toast.success('인터뷰를 시작합니다!');\n      setPhase('interview');");

fs.writeFileSync(path, txt);
