/**
 * agent-hierarchy.ts — 에이전트 계층 구조 유틸리티
 *
 * plan.md Phase 3 개선①: 순환 참조(Circular Dependency) 방지
 *
 * REST API를 통해 A.reportsTo = B, B.reportsTo = A 같은 순환이 생성되면
 * Phase 4 다중 에이전트 오케스트레이션에서 무한 루프가 발생합니다.
 *
 * ── 알고리즘 ────────────────────────────────────────────────────────────────
 *  proposedParentId 부터 reportsTo 를 따라 루트(null)까지 순회하며
 *  agentId(변경 대상) 또는 이미 방문한 노드가 나타나면 순환으로 판단합니다.
 *  DB 조회 횟수는 트리 깊이만큼만 수행됩니다(최대 ~10회, 실제 트리 깊이 제한).
 */

import { db, agents, eq, and, isNull } from '@openmento/db';

/** 에이전트 DB row에서 순환 감지에 필요한 최소 필드 */
interface AgentParentRow {
  reportsTo: string | null;
}

/**
 * 에이전트 계층에서 순환 참조 여부를 감지합니다.
 *
 * @param agentId          변경 중인 에이전트 UUID (신규 생성 시 null)
 * @param proposedParentId 설정하려는 reportsTo 값
 * @param institutionId    기관 UUID (멀티테넌트 격리)
 * @param fetcher          테스트 주입용 DB 조회 함수 (생략 시 실제 DB 사용)
 * @returns true면 순환 참조 존재 → 요청 거부 필요
 */
export async function hasCyclicParent(
  agentId: string | null,
  proposedParentId: string,
  institutionId: string,
  fetcher?: (id: string, instId: string) => Promise<AgentParentRow | null>,
): Promise<boolean> {
  const resolvedFetcher = fetcher ?? defaultFetcher;

  let currentId: string | null = proposedParentId;
  const visited = new Set<string>();

  while (currentId !== null) {
    // 변경 대상 에이전트가 부모 체인에 속하면 순환
    if (agentId && currentId === agentId) return true;

    // 기존 데이터에 이미 순환이 있는 경우 방지 (무한 루프 차단)
    if (visited.has(currentId)) return true;
    visited.add(currentId);

    const row = await resolvedFetcher(currentId, institutionId);
    if (!row) break; // 에이전트가 존재하지 않으면 (삭제됨 등) 순환 없음으로 처리

    currentId = row.reportsTo ?? null;
  }

  return false;
}

async function defaultFetcher(
  id: string,
  institutionId: string,
): Promise<AgentParentRow | null> {
  const [row] = await db
    .select({ reportsTo: agents.reportsTo })
    .from(agents)
    .where(
      and(
        eq(agents.id, id),
        eq(agents.institutionId, institutionId),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);

  return row ?? null;
}
