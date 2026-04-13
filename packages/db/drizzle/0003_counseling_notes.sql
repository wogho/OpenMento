CREATE TYPE "public"."counseling_sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TABLE "counseling_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"sentiment" "counseling_sentiment" DEFAULT 'neutral' NOT NULL,
	"summary" text,
	"counseled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DROP TABLE "institution_secrets" CASCADE;--> statement-breakpoint
ALTER TABLE "counseling_notes" ADD CONSTRAINT "counseling_notes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_notes" ADD CONSTRAINT "counseling_notes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counseling_notes_student_id_idx" ON "counseling_notes" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "counseling_notes_course_id_idx" ON "counseling_notes" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "counseling_notes_counseled_at_idx" ON "counseling_notes" USING btree ("counseled_at");--> statement-breakpoint
CREATE INDEX "counseling_notes_deleted_at_idx" ON "counseling_notes" USING btree ("deleted_at");