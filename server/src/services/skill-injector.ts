/**
 * skill-injector.ts — 강사 스킬 파일 인메모리 캐시 + DB 로더
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────
 *
 *  Phase 3-1: instructor_skills DB ↔ System Prompt 주입 브리지
 *    - getSkillMarkdown(): 캐시 HIT → 즉시 반환 / MISS → DB 조회 후 캐시 적재
 *    - invalidateSkillCache(): 스킬 파일 수정/삭제 시 핫 리로드 트리거
 *    - importSkillFromGitHub(): GitHub Raw URL에서 마크다운 + sourceRef 추출
 *    - DB 접근 불가(테스트/offline) 시 null 반환으로 안전하게 동작
 *
 *  admin.ts (skill CRUD) ──┐
 *                          ├─► skillCache + instructor_skills DB ──► tutor-agent.ts
 *  tutor-agent.ts ◄────────┘
 */

import type { Db } from '@educlip/db';
import { instructorSkills } from '@educlip/db/schema';
import { eq, and, isNull, desc } from '@educlip/db';

// ── Write-Through 인메모리 캐시 ───────────────────────────────────────────────
// agentId → (markdown | null)
// null 은 DB 조회 결과가 없음을 캐싱 (negative caching)
const skillCache = new Map<string, string | null>();

// DB 인스턴스 — initSkillInjectorDb()로 주입, 미주입 시 인메모리 전용으로 동작
let _db: Db | null = null;

/**
 * DB 인스턴스를 주입합니다. 서버 기동 시 한 번 호출하면 됩니다.
 * 테스트 환경에서는 호출하지 않으면 인메모리 전용으로 동작합니다.
 */
export function initSkillInjectorDb(db: Db): void {
  _db = db;
}

/**
 * 에이전트에 바인딩된 활성 스킬 마크다운을 반환합니다.
 * 캐시 미스이고 DB가 주입된 경우 DB를 조회하여 캐시에 적재합니다.
 * DB 접근도 불가능하거나 스킬이 없으면 null을 반환합니다.
 */
export async function getSkillMarkdown(
  agentId: string,
  institutionId: string,
): Promise<string | null> {
  if (skillCache.has(agentId)) {
    return skillCache.get(agentId)!;
  }

  if (!_db) {
    return null;
  }

  try {
    const [skill] = await _db
      .select({ markdown: instructorSkills.markdown })
      .from(instructorSkills)
      .where(
        and(
          eq(instructorSkills.agentId, agentId),
          eq(instructorSkills.institutionId, institutionId),
          eq(instructorSkills.isActive, true),
          isNull(instructorSkills.deletedAt),
        ),
      )
      .orderBy(desc(instructorSkills.createdAt))
      .limit(1);

    const markdown = skill?.markdown ?? null;
    skillCache.set(agentId, markdown);
    return markdown;
  } catch (err) {
    console.warn('[SkillInjector] DB 조회 실패, null 반환합니다.', err);
    return null;
  }
}

/**
 * 스킬 캐시를 무효화합니다.
 * 스킬 파일 수정/삭제 시 호출하여 다음 요청에서 DB를 재조회하게 합니다.
 */
export function invalidateSkillCache(agentId: string): void {
  skillCache.delete(agentId);
}

/**
 * GitHub Raw URL에서 마크다운을 가져오고 sourceRef를 추출합니다.
 * sourceRef는 URL 경로의 ref 세그먼트(커밋 해시 또는 브랜치명)에서 추출합니다.
 *
 * @example
 *   importSkillFromGitHub('https://raw.githubusercontent.com/org/repo/a1b2c3/skills/java.md')
 *   // → { markdown: '...', sourceRef: 'a1b2c3', sourceUrl: 'https://...' }
 */
export async function importSkillFromGitHub(
  rawUrl: string,
): Promise<{ markdown: string; sourceRef: string; sourceUrl: string }> {
  // URL 형식 검증 (XSS / SSRF 방지: raw.githubusercontent.com 만 허용)
  const parsed = new URL(rawUrl);
  if (parsed.hostname !== 'raw.githubusercontent.com') {
    throw new Error(
      `허용되지 않는 호스트입니다. raw.githubusercontent.com 만 허용됩니다. (받은 값: ${parsed.hostname})`,
    );
  }

  const response = await fetch(rawUrl, {
    headers: { Accept: 'text/plain, text/markdown, */*' },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub Raw URL 요청 실패: ${response.status} ${response.statusText}`,
    );
  }

  const markdown = await response.text();

  // URL 경로에서 ref 추출: /{owner}/{repo}/{ref}/{...path}
  const segments = parsed.pathname.split('/').filter(Boolean);
  const sourceRef = segments[2] ?? '';

  return { markdown, sourceRef, sourceUrl: rawUrl };
}

/**
 * 테스트용: 캐시 및 DB 인스턴스를 초기화합니다.
 */
export function _resetForTest(): void {
  skillCache.clear();
  _db = null;
}
