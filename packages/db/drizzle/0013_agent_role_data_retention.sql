-- Phase 5-5: agentRoleEnum 에 data_retention 추가
-- 수료 후 5년 자동 삭제 Heartbeat 에이전트 역할 등록
ALTER TYPE "public"."agent_role" ADD VALUE IF NOT EXISTS 'data_retention';
