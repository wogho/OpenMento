CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"student_id" uuid,
	"agent_id" uuid,
	"content" text NOT NULL,
	"rag_sources_json" jsonb,
	"llm_meta_json" jsonb,
	"turn_index" integer DEFAULT 0 NOT NULL,
	"course_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institution_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"key_name" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_secrets_institution_key_unique" UNIQUE("institution_id","key_name")
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_secrets" ADD CONSTRAINT "institution_secrets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conv_messages_session_idx" ON "conversation_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "conv_messages_student_idx" ON "conversation_messages" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "conv_messages_agent_idx" ON "conversation_messages" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conv_messages_session_turn_idx" ON "conversation_messages" USING btree ("session_id","turn_index");