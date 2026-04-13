import { HeroWithMockup } from "@/components/blocks/hero-with-mockup";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* ── 네비게이션 헤더 ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-b border-gray-100/50 dark:border-slate-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl overflow-hidden shadow-md shadow-blue-500/30">
            <img src="/icon-512.png" alt="OpenMento" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-gray-900 dark:text-white tracking-tight text-lg">OpenMento</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="/login/student" className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium px-4 py-2 rounded-xl hover:bg-gray-100/80 dark:hover:bg-slate-800/80 transition-all">
            수강생 로그인
          </a>
          <a href="/setup" className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/50 transition-all">
            기관 생성하기
          </a>
          <a href="/login/admin" className="text-sm text-white bg-blue-600 hover:bg-blue-700 font-medium px-4 py-2 rounded-xl shadow-md shadow-blue-500/30 transition-all duration-200 hover:-translate-y-px">
            관리자 로그인
          </a>
        </div>
      </nav>

      <main className="flex-1 flex flex-col justify-center">
        <HeroWithMockup
          title="AI 기반 맞춤형 교육 플랫폼"
          description="OpenMento는 강사와 수강생을 연결하는 엔터프라이즈급 AI 튜터링 플랫폼입니다. 소크라테스식 질문 응답과 실시간 EWS 모니터링으로 교육의 질을 높입니다."
          primaryCta={{ text: "수강생 포털 입장", href: "/login/student" }}
          secondaryCta={{ text: "기관 생성하기", href: "/setup" }}
          mockupImage={{
            src: "/dashboard-preview.png",
            alt: "OpenMento Dashboard",
            width: 1280,
            height: 800,
          }}
          mockupImageScrolled="/dashboard-preview-2.png"
        />
      </main>
    </div>
  );
}
