/**
 * persona-service.ts — DB 기반 페르소나 템플릿 관리 (Phase 4-1 개선①)
 *
 * 기존 persona-prompts.ts의 하드코딩 배열 대신 DB의 persona_templates 테이블을 사용합니다.
 * - 전역 기본 페르소나 (institutionId IS NULL): 플랫폼 제공 기본값
 * - 기관별 커스텀 페르소나 (institutionId = UUID): GUI에서 추가한 페르소나
 * - 우선순위: 기관 커스텀 > 전역 기본
 *
 * 하위 호환:
 * - legacyKey로 persona-prompts.ts의 기존 id를 매핑합니다.
 * - persona-prompts.ts의 PERSONA_TEMPLATES를 DB 시드로 사용합니다.
 */

import {
  db,
  personaTemplates,
  eq,
  isNull,
  or,
  and,
} from '@educlip/db';
import { PERSONA_TEMPLATES as SEED_TEMPLATES } from './persona-prompts.js';

export interface PersonaRecord {
  id: string;            // DB UUID
  legacyKey: string | null;
  industry: string;
  role: string;
  prompt: string;
}

/** DB에서 기관 페르소나 + 전역 페르소나를 합산하여 반환 */
export async function listPersonas(institutionId: string): Promise<PersonaRecord[]> {
  const rows = await db
    .select()
    .from(personaTemplates)
    .where(
      and(
        or(
          isNull(personaTemplates.institutionId),
          eq(personaTemplates.institutionId, institutionId),
        ),
        isNull(personaTemplates.deletedAt),
        eq(personaTemplates.isActive, true),
      ),
    );

  // 기관 커스텀이 동일 legacyKey를 가지면 전역을 덮어씁니다.
  const map = new Map<string, PersonaRecord>();
  // 전역 먼저 삽입
  for (const row of rows.filter((r) => r.institutionId === null)) {
    map.set(row.id, row as PersonaRecord);
  }
  // 기관 커스텀으로 덮어쓰기
  for (const row of rows.filter((r) => r.institutionId !== null)) {
    map.set(row.id, row as PersonaRecord);
  }

  return [...map.values()];
}

/** ID(UUID)로 단일 페르소나 조회 */
export async function getPersonaById(id: string): Promise<PersonaRecord | undefined> {
  const [row] = await db
    .select()
    .from(personaTemplates)
    .where(
      and(
        eq(personaTemplates.id, id),
        isNull(personaTemplates.deletedAt),
        eq(personaTemplates.isActive, true),
      ),
    )
    .limit(1);

  return row as PersonaRecord | undefined;
}

/** legacyKey로 페르소나 조회 (하위 호환용) */
export async function getPersonaByLegacyKey(
  legacyKey: string,
  institutionId?: string,
): Promise<PersonaRecord | undefined> {
  const condition = institutionId
    ? and(
        eq(personaTemplates.legacyKey, legacyKey),
        or(
          isNull(personaTemplates.institutionId),
          eq(personaTemplates.institutionId, institutionId),
        ),
        isNull(personaTemplates.deletedAt),
        eq(personaTemplates.isActive, true),
      )
    : and(
        eq(personaTemplates.legacyKey, legacyKey),
        isNull(personaTemplates.institutionId),
        isNull(personaTemplates.deletedAt),
        eq(personaTemplates.isActive, true),
      );

  const rows = await db
    .select()
    .from(personaTemplates)
    .where(condition)
    .limit(2);

  // 기관 커스텀 우선
  const custom = rows.find((r) => r.institutionId !== null);
  const global = rows.find((r) => r.institutionId === null);
  return (custom ?? global) as PersonaRecord | undefined;
}

/** 기관용 커스텀 페르소나 생성 */
export async function createPersona(
  institutionId: string,
  data: { industry: string; role: string; prompt: string; legacyKey?: string },
): Promise<PersonaRecord> {
  const [row] = await db
    .insert(personaTemplates)
    .values({
      institutionId,
      industry: data.industry,
      role: data.role,
      prompt: data.prompt,
      legacyKey: data.legacyKey ?? null,
    })
    .returning();

  return row as PersonaRecord;
}

/** 페르소나 수정 */
export async function updatePersona(
  id: string,
  institutionId: string,
  data: Partial<{ industry: string; role: string; prompt: string; isActive: boolean }>,
): Promise<PersonaRecord> {
  const [row] = await db
    .update(personaTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(personaTemplates.id, id),
        eq(personaTemplates.institutionId, institutionId),
      ),
    )
    .returning();

  if (!row) throw Object.assign(new Error('페르소나를 찾을 수 없습니다.'), { statusCode: 404 });
  return row as PersonaRecord;
}

/** 페르소나 Soft Delete */
export async function deletePersona(id: string, institutionId: string): Promise<void> {
  const result = await db
    .update(personaTemplates)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(personaTemplates.id, id),
        eq(personaTemplates.institutionId, institutionId),
        isNull(personaTemplates.deletedAt),
      ),
    )
    .returning({ id: personaTemplates.id });

  if (result.length === 0) {
    throw Object.assign(
      new Error('페르소나를 찾을 수 없거나 전역 템플릿은 삭제할 수 없습니다.'),
      { statusCode: 404 },
    );
  }
}

/**
 * DB 초기화: persona-prompts.ts의 SEED_TEMPLATES를 전역 페르소나로 삽입합니다.
 * 이미 삽입된 legacyKey는 건너뜁니다 (idempotent).
 */
export async function seedPersonaTemplates(): Promise<void> {
  for (const t of SEED_TEMPLATES) {
    const existing = await getPersonaByLegacyKey(t.id);
    if (!existing) {
      await db.insert(personaTemplates).values({
        institutionId: null, // 전역 기본값
        legacyKey: t.id,
        industry: t.industry,
        role: t.role,
        prompt: t.prompt,
      });
    }
  }
}
