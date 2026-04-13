/**
 * rls.ts — Row-Level Security 컨텍스트 헬퍼
 *
 * Phase 5-2 Multi-Tenancy: PostgreSQL RLS 정책과 연동하여
 * 요청 단위로 app.institution_id 세션 변수를 안전하게 설정합니다.
 *
 * 동작 원리:
 *   1. 트랜잭션 시작
 *   2. SET LOCAL app.institution_id = '<UUID|super>'
 *      → 트랜잭션 내에서만 유효 (트랜잭션 종료 시 자동 초기화)
 *      → 커넥션 풀 공유로 인한 크로스 테넌트 오염 방지
 *   3. 콜백 실행 (Drizzle 쿼리들이 RLS 정책에 의해 자동 필터됨)
 *   4. 트랜잭션 커밋/롤백
 *
 * Super Admin 처리:
 *   institutionId = 'super' 로 설정하면 RLS 정책의 super 분기가 활성화되어
 *   모든 기관 데이터에 접근 가능합니다.
 *
 * 사용 예시:
 *   const result = await withTenantContext(req.user.institutionId, async (tx) => {
 *     return tx.select().from(students);
 *   });
 */

import { db } from './client.js';
import { sql } from 'drizzle-orm';

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 멀티 테넌트 격리 트랜잭션 래퍼.
 *
 * @param institutionId - 기관 UUID 또는 'super' (Super Admin 전체 접근)
 * @param callback - 격리된 트랜잭션 컨텍스트에서 실행할 콜백
 * @returns 콜백의 반환값
 */
export async function withTenantContext<T>(
  institutionId: string,
  callback: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // SET LOCAL: 현재 트랜잭션 범위에서만 유효, 트랜잭션 종료 시 자동 초기화
    // → 커넥션 풀에서 다음 요청이 같은 커넥션을 재사용해도 오염되지 않음
    await tx.execute(sql`SET LOCAL app.institution_id = ${institutionId}`);
    return callback(tx);
  });
}

/**
 * 트랜잭션 없이 세션 레벨로 컨텍스트를 설정합니다.
 * 단일 SELECT 쿼리용 경량 헬퍼. 커넥션 풀 환경에서는 withTenantContext 사용 권장.
 *
 * @param institutionId - 기관 UUID 또는 'super'
 */
export async function setTenantSession(institutionId: string): Promise<void> {
  await db.execute(sql`SET app.institution_id = ${institutionId}`);
}
