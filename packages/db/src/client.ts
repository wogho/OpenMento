import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.');
}

// postgres.js 클라이언트 (paperclip 방식 차용)
const sql = postgres(connectionString, { max: 10 });

export const db = drizzle(sql, { schema });

export type Db = typeof db;
