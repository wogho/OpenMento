-- heartbeat_disabled 컬럼 추가 (수강생 개별 heartbeat 비활성화 설정)
ALTER TABLE "student_agent_preferences"
  ADD COLUMN IF NOT EXISTS "heartbeat_disabled" boolean NOT NULL DEFAULT true;

-- agent_message_type ENUM 생성
CREATE TYPE IF NOT EXISTS "agent_message_type" AS ENUM (
  'heartbeat',
  'agent_reply',
  'task_comment'
);

-- agent_messages 테이블 생성 (에이전트 자율 발화 + 에이전트 간 교신)
CREATE TABLE IF NOT EXISTS "agent_messages" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "institution_id"   uuid NOT NULL REFERENCES "institutions"("id") ON DELETE CASCADE,
  "author_agent_id"  uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "target_agent_id"  uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "target_student_id" uuid REFERENCES "students"("id") ON DELETE SET NULL,
  "course_id"        uuid REFERENCES "courses"("id") ON DELETE SET NULL,
  "body"             text NOT NULL,
  "message_type"     "agent_message_type" NOT NULL DEFAULT 'heartbeat',
  "turn_index"       integer NOT NULL DEFAULT 0,
  "trigger_message_id" uuid,
  "delivered"        text NOT NULL DEFAULT 'pending',
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS "agent_messages_institution_idx" ON "agent_messages"("institution_id");
CREATE INDEX IF NOT EXISTS "agent_messages_author_idx"      ON "agent_messages"("author_agent_id");
CREATE INDEX IF NOT EXISTS "agent_messages_student_idx"     ON "agent_messages"("target_student_id");
CREATE INDEX IF NOT EXISTS "agent_messages_course_idx"      ON "agent_messages"("course_id");
CREATE INDEX IF NOT EXISTS "agent_messages_created_idx"     ON "agent_messages"("created_at");
