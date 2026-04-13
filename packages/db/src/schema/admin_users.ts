import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { institutions } from './institutions.js';

/**
 * 관리자 계정 테이블
 * - 최초 설치 시 seed 또는 setup API로 첫 번째 admin 계정 생성
 * - role: 'admin' | 'teacher'
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'cascade' }).notNull(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  // superadmin 제거, admin으로 통일
  role: text('role').notNull().default('admin'), // 'admin' | 'teacher'
  // 세부적인 접근 권한을 위한 비트마스크 또는 정수형 권한 값
  permissions: integer('permissions').notNull().default(0),
  tags: jsonb('tags').$type<string[]>(), // 강사 AD 분류 (RAG 태그 공통)
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
