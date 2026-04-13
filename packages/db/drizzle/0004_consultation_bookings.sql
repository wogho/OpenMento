CREATE TYPE "public"."consultation_status" AS ENUM('pending', 'confirmed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "consultation_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"triggered_by_score_id" uuid,
	"status" "consultation_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_bookings" ADD CONSTRAINT "consultation_bookings_triggered_by_score_id_ews_risk_scores_id_fk" FOREIGN KEY ("triggered_by_score_id") REFERENCES "public"."ews_risk_scores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consultation_bookings_institution_id_idx" ON "consultation_bookings" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "consultation_bookings_student_id_idx" ON "consultation_bookings" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "consultation_bookings_status_idx" ON "consultation_bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "consultation_bookings_requested_at_idx" ON "consultation_bookings" USING btree ("requested_at");
