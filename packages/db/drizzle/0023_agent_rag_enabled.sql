-- RAG 활성화 여부 컬럼 추가 (기본값 true — 기존 에이전트는 RAG 활성화 상태 유지)
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "rag_enabled" boolean NOT NULL DEFAULT true;
