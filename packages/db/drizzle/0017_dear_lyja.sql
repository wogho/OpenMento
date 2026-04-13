CREATE TABLE "student_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "rag_documents" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "rag_documents" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "rag_documents" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "student_skills" ADD CONSTRAINT "student_skills_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_skills" ADD CONSTRAINT "student_skills_skill_id_instructor_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."instructor_skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_skills_student_id_idx" ON "student_skills" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_skills_skill_id_idx" ON "student_skills" USING btree ("skill_id");