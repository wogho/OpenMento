export { db } from './client.js';
export type { Db } from './client.js';
export * from './schema/index.js';
export * from './zod/index.js';
export { withTenantContext, setTenantSession } from './rls.js';

// drizzle-orm 쿼리 빌더 유틸리티 재수출
// 소비자 패키지에서 drizzle-orm을 직접 의존하지 않아도 됩니다
export { eq, asc, desc, and, or, isNull, isNotNull, sql, inArray, gte, lte, lt, gt, count } from 'drizzle-orm';

