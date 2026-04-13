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
 *  ── 스킬 조회 우선순위 ─────────────────────────────────────────────────
 *  1순위: instructor_skills DB (강사 커스텀 스킬)
 *  2순위: server/src/skills/*.md 기본 스킬 레지스트리 (에이전트 role 기반)
 *  3순위: null (호출부에서 하드코딩된 인라인 프롬프트 사용)
 *
 *  admin.ts (skill CRUD) ──┐
 *                          ├─► skillCache + instructor_skills DB ──► tutor-agent.ts
 *  tutor-agent.ts ◄────────┘
 */

import { LRUCache } from 'lru-cache';
import type { Db } from '@openmento/db';
import { instructorSkills } from '@openmento/db/schema';
import { eq, and, isNull, desc } from '@openmento/db';
import { getDefaultSkillByRole } from './skill-registry.js';

// ── Write-Through LRU 캐시 ───────────────────────────────────────────────────
// agentId → (markdown | null)
// null 은 DB 조회 결과가 없음을 캐싱 (negative caching)
// max: 500 에이전트를 초과하면 LRU 방식으로 오래된 항목 자동 소멸
// lru-cache v11은 Value에 null 불허 → undefined를 null 대신 사용하는 내부 sentinel로 감싸거나
// allowStale/noDeleteOnFetchRejection 대신 string 값을 Wrapper로 사용
// → 간결성을 위해 string | undefined 로 타입 변경 후 get 결과를 null 변환
const skillCache = new LRUCache<string, string>({ max: 500 });

// negative caching sentinel: 스킬 없음을 캐시에 표시 (빈 문자열은 유효한 스킬이 아님)
const NEGATIVE_SENTINEL = '';

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
 * 조회 우선순위: 1) DB 커스텀 스킬 → 2) 기본 스킬 레지스트리 → 3) null
 *
 * @param agentId       에이전트 UUID (DB 조회 키)
 * @param institutionId 기관 UUID (멀티테넌트 격리)
 * @param agentRole     에이전트 역할 (기본 스킬 폴백용, 옵셔널)
 */
export async function getSkillMarkdown(
  agentId: string,
  institutionId: string,
  agentRole?: string,
): Promise<string | null> {
  if (skillCache.has(agentId)) {
    const cached = skillCache.get(agentId)!;
    return cached === NEGATIVE_SENTINEL ? null : cached;
  }

  if (!_db) {
    // DB 없음 → 기본 스킬 레지스트리 폴백
    return agentRole ? getDefaultSkillByRole(agentRole) : null;
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

    if (skill?.markdown) {
      // 1순위: DB 커스텀 스킬
      skillCache.set(agentId, skill.markdown);
      return skill.markdown;
    }

    // 2순위: 기본 스킬 레지스트리 폴백 (커스텀 스킬 없을 때)
    const defaultSkill = agentRole ? getDefaultSkillByRole(agentRole) : null;
    // negative caching: 기본 스킬도 없으면 SENTINEL 캐시
    skillCache.set(agentId, defaultSkill ?? NEGATIVE_SENTINEL);
    return defaultSkill;
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

/** GitHub 임포트 최대 파일 크기: 60,000 bytes (≈ 15,000 토큰) */
const MAX_SKILL_BYTES = 60_000;
/** GitHub 임포트 최대 대기 시간: 5초 */
const IMPORT_TIMEOUT_MS = 5_000;

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

  // 5초 타임아웃 (AbortController)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(rawUrl, {
      headers: { Accept: 'text/plain, text/markdown, */*' },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(
        `GitHub Raw URL 요청 타임아웃 (${IMPORT_TIMEOUT_MS / 1000}초 초과): ${rawUrl}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `GitHub Raw URL 요청 실패: ${response.status} ${response.statusText}`,
    );
  }

  // Content-Length 헤더로 사전 크기 검증
  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_SKILL_BYTES) {
    throw new Error(
      `스킬 파일이 너무 큽니다. 최대 ${MAX_SKILL_BYTES.toLocaleString()} bytes까지 허용됩니다. (받은 값: ${contentLength.toLocaleString()} bytes)`,
    );
  }

  const markdown = await response.text();

  // 실제 본문 크기 재검증 (Content-Length 헤더가 없거나 신뢰할 수 없는 경우)
  const byteLength = Buffer.byteLength(markdown, 'utf8');
  if (byteLength > MAX_SKILL_BYTES) {
    throw new Error(
      `스킬 파일이 너무 큽니다. 최대 ${MAX_SKILL_BYTES.toLocaleString()} bytes까지 허용됩니다. (실제 크기: ${byteLength.toLocaleString()} bytes)`,
    );
  }

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

/** 테스트용: 현재 캐시 크기를 반환합니다. */
export function _getCacheSizeForTest(): number {
  return skillCache.size;
}
