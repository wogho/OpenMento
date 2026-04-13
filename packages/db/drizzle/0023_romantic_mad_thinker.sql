CREATE TYPE "public"."agent_message_type" AS ENUM('heartbeat', 'agent_reply', 'task_comment');--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"author_agent_id" uuid NOT NULL,
	"target_agent_id" uuid,
	"target_student_id" uuid,
	"course_id" uuid,
	"body" text NOT NULL,
	"message_type" "agent_message_type" DEFAULT 'heartbeat' NOT NULL,
	"turn_index" integer DEFAULT 0 NOT NULL,
	"trigger_message_id" uuid,
	"delivered" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"week_no" smallint NOT NULL,
	"session_no" smallint NOT NULL,
	"session_date" date NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "qr_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "portfolio_post_comments" DROP CONSTRAINT "portfolio_post_comments_agent_id_admin_users_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "week_no" smallint;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "session_no" smallint;--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "check_method" text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "attendance_logs" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "student_agent_preferences" ADD COLUMN "heartbeat_disabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_target_student_id_students_id_fk" FOREIGN KEY ("target_student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_institution_idx" ON "agent_messages" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "agent_messages_author_idx" ON "agent_messages" USING btree ("author_agent_id");--> statement-breakpoint
CREATE INDEX "agent_messages_student_idx" ON "agent_messages" USING btree ("target_student_id");--> statement-breakpoint
CREATE INDEX "agent_messages_course_idx" ON "agent_messages" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "agent_messages_created_idx" ON "agent_messages" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "portfolio_post_comments" ADD CONSTRAINT "portfolio_post_comments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;