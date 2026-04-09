/**
 * secrets-encryption.ts — pgcrypto 기반 기관 비밀 값 암호화 서비스 (Phase 5-5)
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────────
 *
 *   institution_settings 테이블에서 settingKey='secrets' 행의 settingValue를
 *   PostgreSQL  pgcrypto 익스텐션의 PGP 대칭키 암호화로 보호합니다.
 *
 *   ① encryptSecretJson(plainObj)   — 평문 객체 → pgp_sym_encrypt(armored) 문자열
 *   ② decryptSecretJson(cipherText) — 암호 문자열 → 평문 객체
 *   ③ isEncrypted(value)            — 현재 값이 암호화 상태인지 판별
 *
 * ── 환경 변수 ─────────────────────────────────────────────────────────────────
 *
 *   SECRETS_ENCRYPTION_KEY  (필수, ≥ 32자 권장)
 *     - DB에 저장되는 비밀 값(OpenAI·Anthropic API 키 등)을 암호화할 키
 *     - 분실 시 복호화 불가 — KMS 또는 Vault에 반드시 백업
 *
 * ── 사용 흐름 ────────────────────────────────────────────────────────────────
 *
 *   [WRITE] setInstitutionSetting('inst-xxx', 'secrets', rawSecrets)
 *     → secrets-encryption.ts: encryptSecretJson(rawSecrets)
 *     → DB에 { _enc: true, data: '-----BEGIN PGP MESSAGE-----...' } 형태로 저장
 *
 *   [READ] getInstitutionSetting('inst-xxx', 'secrets', defaultSecrets)
 *     → secrets-encryption.ts: isEncrypted(cached) ? decryptSecretJson : return as-is
 *     → 복호화된 평문 객체 반환
 *
 * ── 보안 고려사항 ─────────────────────────────────────────────────────────────
 *
 *   - pgcrypto의 pgp_sym_encrypt/decrypt는 OpenPGP RFC 4880 표준을 따릅니다.
 *   - 매 암호화마다 무작위 세션 키가 생성되므로 동일 평문도 매번 다른 암호문이 됩니다.
 *   - 단일 키(symmetric) 방식 — 향후 asymmetric으로 업그레이드 가능합니다.
 *   - 키는 환경 변수로만 관리하며 소스 코드·DB에 절대 저장하지 않습니다.
 */

import { db, sql } from '@educlip/db';
import { logger } from '../utils/logger.js';

// ── 암호화 키 (Fail-Fast) ─────────────────────────────────────────────────────

const ENCRYPTION_KEY = process.env.SECRETS_ENCRYPTION_KEY;

// 테스트 환경에서는 키가 없어도 허용 (단, 암호화 호출 시 오류 발생)
const isTestEnv = process.env.NODE_ENV === 'test';

if (!ENCRYPTION_KEY && !isTestEnv) {
  throw new Error(
    '[secrets-encryption] SECRETS_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다. ' +
    '32자 이상의 무작위 문자열을 KMS 또는 .env에 설정하십시오.',
  );
}

// ── 암호화된 봉투 타입 ────────────────────────────────────────────────────────

/** DB에 저장되는 암호화 봉투 구조 */
export interface EncryptedEnvelope {
  _enc: true;
  v: 1;            // 포맷 버전 — 향후 키 로테이션 시 v2로 올릴 수 있습니다.
  data: string;    // pgcrypto가 생성한 ASCII-armored PGP 메시지
}

// ── 타입 가드 ─────────────────────────────────────────────────────────────────

/**
 * 저장된 값이 암호화 봉투 형태인지 확인합니다.
 *
 * DB에는 기존에 평문으로 저장된 레코드도 있을 수 있으므로
 * 읽기 시 반드시 이 함수로 먼저 분기해야 합니다.
 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v._enc === true && v.v === 1 && typeof v.data === 'string';
}

// ── 암호화 ────────────────────────────────────────────────────────────────────

/**
 * 평문 객체를 pgcrypto PGP 대칭키 암호화하여 봉투 형태로 반환합니다.
 *
 * @throws SECRETS_ENCRYPTION_KEY 미설정 시 오류
 */
export async function encryptSecretJson(plain: object): Promise<EncryptedEnvelope> {
  if (!ENCRYPTION_KEY) {
    throw new Error('[secrets-encryption] SECRETS_ENCRYPTION_KEY 미설정 — 암호화 불가');
  }

  const plainText = JSON.stringify(plain);

  // pgcrypto: pgp_sym_encrypt(data, key, options)
  // cipher-algo: AES256, s2k-digest-algo: SHA512, compress-algo: 1(ZIP)
  const [row] = await db.execute<{ enc: string }>(
    sql`SELECT pgp_sym_encrypt(
      ${plainText}::text,
      ${ENCRYPTION_KEY}::text,
      'cipher-algo=aes256,s2k-digest-algo=sha512,compress-algo=1'
    )::text AS enc`,
  );

  if (!row?.enc) {
    throw new Error('[secrets-encryption] pgp_sym_encrypt 결과가 비어 있습니다.');
  }

  logger.debug('[secrets-encryption] 비밀 값 암호화 완료');

  return { _enc: true, v: 1, data: row.enc };
}

// ── 복호화 ────────────────────────────────────────────────────────────────────

/**
 * 암호화 봉투를 복호화하여 평문 객체로 반환합니다.
 *
 * @throws 키 불일치·손상된 데이터 시 PostgreSQL 오류
 */
export async function decryptSecretJson<T extends object>(envelope: EncryptedEnvelope): Promise<T> {
  if (!ENCRYPTION_KEY) {
    throw new Error('[secrets-encryption] SECRETS_ENCRYPTION_KEY 미설정 — 복호화 불가');
  }

  const [row] = await db.execute<{ plain: string }>(
    sql`SELECT pgp_sym_decrypt(
      ${envelope.data}::bytea,
      ${ENCRYPTION_KEY}::text
    )::text AS plain`,
  );

  if (!row?.plain) {
    throw new Error('[secrets-encryption] pgp_sym_decrypt 결과가 비어 있습니다.');
  }

  logger.debug('[secrets-encryption] 비밀 값 복호화 완료');

  return JSON.parse(row.plain) as T;
}

// ── 통합 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * DB에서 읽은 settingValue를 안전하게 역직렬화합니다.
 *
 * - 암호화 봉투이면 복호화 후 반환
 * - 평문 객체이면 그대로 반환 (레거시 호환)
 */
export async function safeDecryptIfNeeded<T extends object>(
  value: unknown,
  fallback: T,
): Promise<T> {
  if (isEncryptedEnvelope(value)) {
    try {
      return await decryptSecretJson<T>(value);
    } catch (err) {
      logger.error({ err }, '[secrets-encryption] 복호화 실패 — 폴백 반환');
      return { ...fallback };
    }
  }
  if (value !== null && typeof value === 'object') {
    return value as T;
  }
  return { ...fallback };
}
