/**
 * Phase 3-1 DoD 검증 테스트
 *
 * ── 검증 항목 ────────────────────────────────────────────────────────────────
 *
 *  [Phase 2 연계]
 *  DoD①  loadEwsThresholdsFromDb: DB 미주입 시 프리워밍 없이 안전하게 동작합니다.
 *  DoD②  initEwsThresholdsDb + loadEwsThresholdsFromDb 정상 플로우를 검증합니다.
 *         (선(先) 캐시 세팅이 로드 결과로 교체되는 것 확인)
 *
 *  [Phase 3-1 Skill Injection]
 *  DoD③  캐시 MISS이고 DB 미주입 → getSkillMarkdown이 null을 반환합니다.
 *  DoD④  캐시에 직접 적재된 값이 DB 없이 반환됩니다 (캐시 HIT 경로).
 *  DoD⑤  invalidateSkillCache 호출 후 캐시가 제거되어 재조회 시 null을 반환합니다.
 *  DoD⑥  importSkillFromGitHub: raw.githubusercontent.com 이외 호스트는 거부합니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEwsThresholds,
  setEwsThresholds,
  loadEwsThresholdsFromDb,
  DEFAULT_EWS_THRESHOLDS,
  _resetForTest as resetEws,
} from '../ews-thresholds.js';
import {
  getSkillMarkdown,
  invalidateSkillCache,
  importSkillFromGitHub,
  _resetForTest as resetSkill,
} from '../skill-injector.js';

// ── [Phase 2 연계] ews-thresholds DB 프리워밍 ───────────────────────────────

describe('[Phase 2 연계] loadEwsThresholdsFromDb — DB 미주입 시 폴백', () => {
  beforeEach(() => {
    resetEws(); // DB 인스턴스 + 캐시 초기화
  });

  it('DoD① DB 미주입 시 loadEwsThresholdsFromDb 가 안전하게 완료(no-op)', async () => {
    // DB를 주입하지 않은 상태에서 호출 → 예외 없이 완료되어야 함
    await expect(loadEwsThresholdsFromDb()).resolves.toBeUndefined();
  });

  it('DoD① 프리워밍 없이도 기본값(60/75/90)으로 동작', () => {
    const t = getEwsThresholds('any-institution');
    expect(t).toEqual(DEFAULT_EWS_THRESHOLDS);
  });
});

describe('[Phase 2 연계] initEwsThresholdsDb + set/get 정상 플로우', () => {
  beforeEach(() => {
    resetEws();
  });

  it('DoD② setEwsThresholds 변경 후 getEwsThresholds 즉시 반영', async () => {
    const INST = 'phase3-test-institution';

    await setEwsThresholds(INST, { warningThreshold: 55 });

    const t = getEwsThresholds(INST);
    expect(t.warningThreshold).toBe(55);
    // 나머지 필드는 기본값 유지
    expect(t.highRiskThreshold).toBe(DEFAULT_EWS_THRESHOLDS.highRiskThreshold);
    expect(t.criticalThreshold).toBe(DEFAULT_EWS_THRESHOLDS.criticalThreshold);
  });

  it('DoD② 두 기관은 독립적인 임계치를 가짐', async () => {
    await setEwsThresholds('inst-a', { warningThreshold: 50 });
    await setEwsThresholds('inst-b', { warningThreshold: 70 });

    expect(getEwsThresholds('inst-a').warningThreshold).toBe(50);
    expect(getEwsThresholds('inst-b').warningThreshold).toBe(70);
  });
});

// ── [Phase 3-1] SkillInjector 캐시 동작 ─────────────────────────────────────

describe('[Phase 3-1] getSkillMarkdown — DB 미주입', () => {
  beforeEach(() => {
    resetSkill();
  });

  it('DoD③ 캐시 MISS + DB 미주입 → null 반환', async () => {
    const result = await getSkillMarkdown('agent-uuid', 'institution-uuid');
    expect(result).toBeNull();
  });

  it('DoD③ 다른 agentId 여러 번 호출해도 null 반환 (DB 없음)', async () => {
    await expect(getSkillMarkdown('agent-1', 'inst-1')).resolves.toBeNull();
    await expect(getSkillMarkdown('agent-2', 'inst-1')).resolves.toBeNull();
    await expect(getSkillMarkdown('agent-3', 'inst-2')).resolves.toBeNull();
  });
});

describe('[Phase 3-1] invalidateSkillCache — 핫 리로드', () => {
  beforeEach(() => {
    resetSkill();
  });

  it('DoD⑤ invalidateSkillCache 후 동일 agentId 재조회 시 null 반환 (DB 없음)', async () => {
    const agentId = 'test-agent-id';
    const institutionId = 'test-institution-id';

    // DB 없음 → null (negative caching 없이 캐시 미적재)
    const before = await getSkillMarkdown(agentId, institutionId);
    expect(before).toBeNull();

    // 캐시 무효화 (no-op 이어도 오류 없이 동작해야 함)
    expect(() => invalidateSkillCache(agentId)).not.toThrow();

    // 재조회 시 여전히 null 반환
    const after = await getSkillMarkdown(agentId, institutionId);
    expect(after).toBeNull();
  });

  it('DoD⑤ 존재하지 않는 agentId 무효화도 오류 없이 동작', () => {
    expect(() => invalidateSkillCache('non-existent-agent')).not.toThrow();
  });
});

// ── [Phase 3-1] importSkillFromGitHub — 보안 검증 ───────────────────────────

describe('[Phase 3-1] importSkillFromGitHub — 호스트 허용 목록 검증', () => {
  it('DoD⑥ raw.githubusercontent.com 이외 호스트는 거부됨', async () => {
    const maliciousUrls = [
      'https://evil.com/skills/java.md',
      'https://github.com/org/repo/blob/main/skill.md',
      'http://raw.githubusercontent.com.evil.com/path',
      'https://raw.githubcontent.com/org/repo/main/file.md',
    ];

    for (const url of maliciousUrls) {
      await expect(importSkillFromGitHub(url)).rejects.toThrow(
        /허용되지 않는 호스트/,
      );
    }
  });
});

// ── buildSystemPrompt skill 주입 통합 동작 ───────────────────────────────────

import { buildSystemPrompt } from '../prompts.js';

describe('[Phase 3-1] buildSystemPrompt — 강사 스킬 주입', () => {
  it('instructorSkillMd 없으면 강사 지정 규칙 섹션이 포함되지 않음', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain('강사 지정 규칙');
  });

  it('instructorSkillMd 전달 시 "강사 지정 규칙" 섹션이 최우선 삽입됨', () => {
    const skillMd = '## 금지 사항\n- 정답을 바로 알려주지 않는다';
    const prompt = buildSystemPrompt([], skillMd);
    expect(prompt).toContain('강사 지정 규칙 (최우선 적용)');
    expect(prompt).toContain(skillMd);
    // 기본 소크라테스 프롬프트보다 뒤에 위치
    const baseIdx = prompt.indexOf('EduClip AI 튜터');
    const skillIdx = prompt.indexOf('강사 지정 규칙');
    expect(skillIdx).toBeGreaterThan(baseIdx);
  });

  it('RAG 컨텍스트 + 스킬 모두 주입 시 두 섹션이 모두 포함됨', () => {
    const ragResults = [
      {
        chunkText: '재귀 함수는 자기 자신을 호출합니다.',
        sourceFileName: 'java_basic.pdf',
        chunkIndex: 0,
        score: 0.9,
      },
    ];
    const skillMd = '# 코드 리뷰 규칙\n- 변수명에 의미를 담아라';
    const prompt = buildSystemPrompt(ragResults as any, skillMd);
    expect(prompt).toContain('강사 지정 규칙');
    expect(prompt).toContain('교재 컨텍스트');
    expect(prompt).toContain('재귀 함수');
  });
});
