ALTER TABLE "students" ADD COLUMN "github_repo" text;--> statement-breakpoint
CREATE INDEX "attendance_logs_active_date_idx" ON "attendance_logs" USING btree ("attendance_date") WHERE "attendance_logs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "conv_messages_unread_idx" ON "conversation_messages" USING btree ("created_at") WHERE "conversation_messages"."is_admin_read" = false;--> statement-breakpoint
CREATE INDEX "students_active_institution_idx" ON "students" USING btree ("institution_id") WHERE "students"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "students_anonymous_id_active_idx" ON "students" USING btree ("anonymous_id") WHERE "students"."deleted_at" IS NULL;