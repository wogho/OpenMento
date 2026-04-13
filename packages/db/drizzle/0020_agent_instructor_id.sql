-- Add instructor_id column to agents table
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "instructor_id" uuid REFERENCES "admin_users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_instructor_id_idx" ON "agents" ("instructor_id");
