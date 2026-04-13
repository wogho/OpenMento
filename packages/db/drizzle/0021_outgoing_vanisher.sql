CREATE TABLE "student_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "student_courses" ADD CONSTRAINT "student_courses_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_courses" ADD CONSTRAINT "student_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_courses_student_course_uidx" ON "student_courses" USING btree ("student_id","course_id");--> statement-breakpoint
CREATE INDEX "student_courses_student_id_idx" ON "student_courses" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_courses_course_id_idx" ON "student_courses" USING btree ("course_id");