CREATE TABLE IF NOT EXISTS "student_agent_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "student_id" uuid NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "course_id" uuid NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "student_agent_pref_student_id_idx"
  ON "student_agent_preferences" ("student_id");

CREATE INDEX IF NOT EXISTS "student_agent_pref_course_id_idx"
  ON "student_agent_preferences" ("course_id");

CREATE INDEX IF NOT EXISTS "student_agent_pref_agent_id_idx"
  ON "student_agent_preferences" ("agent_id");

CREATE UNIQUE INDEX IF NOT EXISTS "student_agent_pref_unique_idx"
  ON "student_agent_preferences" ("student_id", "course_id", "agent_id");
