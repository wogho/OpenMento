/**
 * skill-registry.ts — 기본 스킬 레지스트리
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────
 *
 *  server/src/skills/*.md 에 정의된 에이전트별 기본(Default) 스킬을
 *  서버 기동 시 파일 시스템에서 읽어 메모리에 캐시합니다.
 *
 *  사용 순서 (skill-injector.ts 의 폴백 체인):
 *    1순위: instructor_skills DB (강사 커스텀 스킬)
 *    2순위: 이 레지스트리의 기본 스킬 (에이전트 role 기반)
 *    3순위: 하드코딩된 인라인 프롬프트
 *
 * ── 에이전트 역할 → 파일 매핑 ─────────────────────────────────────────────
 *
 *  'orchestrator'       → orchestrator.md
 *  'ai_instructor'      → ai-instructor.md
 *  'ai_tutor'           → ai-tutor.md
 *  'ews_monitor'        → ews-monitor.md
 *  'mental_care'        → mental-care.md
 *  'portfolio_reviewer' → portfolio-reviewer.md
 */

import { readFileSync, existsSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM __dirname 폴리필
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 스킬 파일이 위치하는 디렉토리 (server/src/skills/)
const SKILLS_DIR = join(__dirname, '../skills');

// 에이전트 역할(role) → 스킬 파일명 매핑
const ROLE_TO_FILE: Record<string, string> = {
  orchestrator:        'orchestrator.md',
  ai_instructor:       'ai-instructor.md',
  ai_tutor:            'ai-tutor.md',
  ews_monitor:         'ews-monitor.md',
  mental_care:         'mental-care.md',
  portfolio_reviewer:  'portfolio-reviewer.md',
};

// 빌트인 스킬 역할 → 표시 이름 매핑
const ROLE_TO_TITLE: Record<string, string> = {
  orchestrator:        'Orchestrator (기본)',
  ai_instructor:       'AI Instructor (기본)',
  ai_tutor:            'AI Tutor (기본)',
  ews_monitor:         'EWS Monitor (기본)',
  mental_care:         'Mental Care (기본)',
  portfolio_reviewer:  'Portfolio Reviewer (기본)',
};

export interface BuiltinSkillMeta {
  id: string;          // 'builtin:orchestrator' 형식
  role: string;
  title: string;
  markdown: string;
  tags: string[];
  isActive: boolean;
  isBuiltIn: true;
  agentId: null;
  courseId: null;
  sourceRef: string;
  sourceUrl: null;
  updatedAt: string;
  updatedBy: null;
}

// 인메모리 캐시: role → 마크다운 문자열
const defaultSkillCache = new Map<string, string>();

/**
 * 단일 스킬 파일을 읽어 캐시에 적재합니다.
 * 파일이 없으면 null을 캐시하지 않고 그냥 건너뜁니다.
 */
function loadSkillFile(role: string, fileName: string): void {
  const filePath = join(SKILLS_DIR, fileName);
  if (!existsSync(filePath)) {
    console.warn(`[SkillRegistry] 스킬 파일 없음: ${filePath}`);
    return;
  }
  try {
    const markdown = readFileSync(filePath, 'utf-8');
    defaultSkillCache.set(role, markdown);
  } catch (err) {
    console.error(`[SkillRegistry] 스킬 파일 로드 실패: ${filePath}`, err);
  }
}

/**
 * 모든 기본 스킬 파일을 로드합니다.
 * 서버 기동 시 한 번 호출하면 됩니다.
 */
export function loadDefaultSkills(): void {
  for (const [role, fileName] of Object.entries(ROLE_TO_FILE)) {
    loadSkillFile(role, fileName);
  }
  console.info(
    `[SkillRegistry] 기본 스킬 ${defaultSkillCache.size}개 로드 완료: [${[...defaultSkillCache.keys()].join(', ')}]`,
  );
}

/**
 * 에이전트 역할(role)에 대응하는 기본 스킬 마크다운을 반환합니다.
 * 해당 역할의 파일이 없거나 로드되지 않은 경우 null을 반환합니다.
 */
export function getDefaultSkillByRole(role: string): string | null {
  return defaultSkillCache.get(role) ?? null;
}

/**
 * 현재 로드된 모든 기본 스킬 역할 목록을 반환합니다.
 * (관리자 UI 또는 디버깅용)
 */
export function listLoadedSkillRoles(): string[] {
  return [...defaultSkillCache.keys()];
}

/**
 * 로드된 모든 빌트인 스킬을 BuiltinSkillMeta 배열로 반환합니다.
 * GET /admin/skills 에서 DB 스킬과 머지하기 위해 사용합니다.
 */
export function listBuiltinSkills(): BuiltinSkillMeta[] {
  return [...defaultSkillCache.entries()].map(([role, markdown]) => ({
    id: `builtin:${role}`,
    role,
    title: ROLE_TO_TITLE[role] ?? role,
    markdown,
    tags: ['기본 스킬'],
    isActive: true,
    isBuiltIn: true as const,
    agentId: null,
    courseId: null,
    sourceRef: `builtin:${role}`,
    sourceUrl: null,
    updatedAt: new Date(0).toISOString(),
    updatedBy: null,
  }));
}

/**
 * 개발 모드에서 스킬 파일 변경 시 자동으로 핫 리로드합니다.
 * NODE_ENV=development 일 때만 활성화됩니다.
 */
export function watchSkillFiles(): void {
  if (process.env.NODE_ENV !== 'development') return;

  if (!existsSync(SKILLS_DIR)) return;

  watch(SKILLS_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith('.md') || filename === 'SKILL.md') return;

    // 변경된 파일에 해당하는 role 찾기
    const role = Object.entries(ROLE_TO_FILE).find(([, f]) => f === filename)?.[0];
    if (!role) return;

    console.info(`[SkillRegistry] 스킬 파일 변경 감지 (${filename}), 리로드 중...`);
    loadSkillFile(role, filename);
    console.info(`[SkillRegistry] '${role}' 스킬 리로드 완료`);
  });

  console.info(`[SkillRegistry] 스킬 파일 변경 감시 시작 (개발 모드)`);
}

/**
 * 테스트용: 캐시를 초기화합니다.
 */
export function _resetRegistryForTest(): void {
  defaultSkillCache.clear();
}
