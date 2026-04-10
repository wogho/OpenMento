/**
 * StageTracker — 포트폴리오 단계별 진행 상황 트래커
 *
 * 단계: 인터뷰 → 기획서 작성 → 보안 검토 → 독창성 인증
 *
 * FSM 단계와 서버의 PortfolioStage 값을 매핑:
 *   interview   → stage 1 (페르소나 인터뷰)
 *   planning    → stage 2 (기획서 작성)
 *   hitl_review → stage 2 (기획서 작성 — 강사 검토 대기)
 *   security_review → stage 3 (보안 검토)
 *   similarity_check → stage 4 (독창성 인증)
 *   approved    → stage 4 완료
 */

export type PortfolioStage =
  | 'interview'
  | 'planning'
  | 'hitl_review'
  | 'security_review'
  | 'similarity_check'
  | 'approved'
  | 'abandoned';

interface Step {
  id: number;
  label: string;
  icon: string;
  stages: PortfolioStage[];
}

const STEPS: Step[] = [
  { id: 1, label: '페르소나 인터뷰', icon: '', stages: ['interview'] },
  { id: 2, label: '기획서 작성',     icon: '', stages: ['planning', 'hitl_review'] },
  { id: 3, label: '보안 검토',       icon: '', stages: ['security_review'] },
  { id: 4, label: '독창성 인증',     icon: '', stages: ['similarity_check', 'approved'] },
];

function resolveStepIndex(stage: PortfolioStage): number {
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i].stages.includes(stage)) return i;
  }
  return 0;
}

interface Props {
  stage: PortfolioStage;
  className?: string;
}

export default function StageTracker({ stage, className = '' }: Props) {
  const currentIdx = resolveStepIndex(stage);
  const isAbandoned = stage === 'abandoned';

  return (
    <div className={`w-full ${className}`} role="progressbar" aria-label="포트폴리오 진행 단계">
      <div className="flex items-center">
        {STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isActive    = idx === currentIdx && !isAbandoned;

          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              {/* 단계 노드 */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center text-lg font-semibold
                    transition-all duration-300 select-none
                    ${isCompleted  ? 'bg-green-500 text-white shadow-sm' :
                      isActive     ? 'bg-blue-600 text-white shadow-md ring-4 ring-blue-100' :
                      isAbandoned && idx === currentIdx ? 'bg-red-400 text-white' :
                                    'bg-gray-100 text-gray-400'}
                  `}
                >
                  {isCompleted ? '' : step.icon}
                </div>
                <span
                  className={`
                    text-xs font-medium text-center whitespace-nowrap
                    ${isCompleted ? 'text-green-600' :
                      isActive    ? 'text-blue-700' :
                                   'text-gray-400'}
                  `}
                >
                  {step.label}
                  {isActive && stage === 'hitl_review' && (
                    <span className="block text-amber-500 font-normal">강사 검토 대기</span>
                  )}
                </span>
              </div>

              {/* 커넥터 라인 (마지막 단계 제외) */}
              {idx < STEPS.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-2 mt-[-18px] rounded transition-colors duration-300
                    ${isCompleted ? 'bg-green-400' : 'bg-gray-200'}
                  `}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* HITL / Abandoned 배너 */}
      {stage === 'hitl_review' && (
        <div className="mt-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span className="text-amber-500 text-lg">⏳</span>
          <p className="text-sm text-amber-800 font-medium">
            강사가 기획서를 검토 중입니다. 승인되면 자동으로 다음 단계로 진행됩니다.
          </p>
        </div>
      )}
      {stage === 'abandoned' && (
        <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="text-red-400 text-lg">️</span>
          <p className="text-sm text-red-800 font-medium">
            세션이 만료되었습니다. 새로운 포트폴리오 워크플로우를 시작해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
