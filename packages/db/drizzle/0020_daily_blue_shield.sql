ALTER TABLE "admin_users" ADD COLUMN "permissions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "category_tag" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "instructor_id" uuid;--> statement-breakpoint
ALTER TABLE "instructor_skills" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_instructor_id_idx" ON "agents" USING btree ("instructor_id");