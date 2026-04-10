-- OpenMento PostgreSQL 초기화 스크립트
-- docker-entrypoint-initdb.d에 의해 DB 최초 생성 시 한 번 실행

-- pgvector: 벡터 유사도 검색 (RAG, 포트폴리오 중복 검사)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm: 텍스트 유사도 검색 (LIKE 쿼리 인덱싱)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- uuid-ossp: UUID 기본 키 생성
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgcrypto: 컬럼 레벨 암호화 (Phase 5-5 — pgp_sym_encrypt / pgp_sym_decrypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
