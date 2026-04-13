CREATE TYPE "public"."comment_author_role" AS ENUM('instructor', 'student');--> statement-breakpoint
CREATE TYPE "public"."chat_sender_role" AS ENUM('instructor', 'student');--> statement-breakpoint
CREATE TYPE "public"."portfolio_post_comment_author_type" AS ENUM('student', 'instructor', 'agent');--> statement-breakpoint
CREATE TYPE "public"."portfolio_post_status" AS ENUM('draft', 'submitted', 'reviewed');--> statement-breakpoint
CREATE TABLE "assignment_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"instructor_id" uuid,
	"student_id" uuid,
	"author_role" "comment_author_role" NOT NULL,
	"content" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"file_url" text,
	"file_name" text,
	"due_at" timestamp with time zone,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "student_agent_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instructor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"type" text DEFAULT 'call' NOT NULL,
	"message" text NOT NULL,
	"read_at" timestamp with time zone,
	"accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"instructor_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"sender_role" "chat_sender_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portfolio_post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_type" "portfolio_post_comment_author_type" NOT NULL,
	"agent_id" uuid,
	"author_name" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portfolio_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"file_url" text,
	"file_name" text,
	"status" "portfolio_post_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "rag_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comments" ADD CONSTRAINT "assignment_comments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_agent_preferences" ADD CONSTRAINT "student_agent_preferences_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_agent_preferences" ADD CONSTRAINT "student_agent_preferences_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_agent_preferences" ADD CONSTRAINT "student_agent_preferences_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_notifications" ADD CONSTRAINT "instructor_notifications_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_notifications" ADD CONSTRAINT "instructor_notifications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_notifications" ADD CONSTRAINT "instructor_notifications_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_chat_messages" ADD CONSTRAINT "instructor_chat_messages_notification_id_instructor_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."instructor_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_chat_messages" ADD CONSTRAINT "instructor_chat_messages_instructor_id_admin_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_chat_messages" ADD CONSTRAINT "instructor_chat_messages_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_chat_messages" ADD CONSTRAINT "instructor_chat_messages_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_post_comments" ADD CONSTRAINT "portfolio_post_comments_post_id_portfolio_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."portfolio_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_post_comments" ADD CONSTRAINT "portfolio_post_comments_agent_id_admin_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_posts" ADD CONSTRAINT "portfolio_posts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_posts" ADD CONSTRAINT "portfolio_posts_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_comments_assignment_id_idx" ON "assignment_comments" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_comments_student_id_idx" ON "assignment_comments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "assignment_comments_instructor_id_idx" ON "assignment_comments" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "assignments_course_id_idx" ON "assignments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "assignments_instructor_id_idx" ON "assignments" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "assignments_deleted_at_idx" ON "assignments" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "student_agent_pref_student_id_idx" ON "student_agent_preferences" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "student_agent_pref_course_id_idx" ON "student_agent_preferences" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "student_agent_pref_agent_id_idx" ON "student_agent_preferences" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_agent_pref_unique_idx" ON "student_agent_preferences" USING btree ("student_id","course_id","agent_id");--> statement-breakpoint
CREATE INDEX "instructor_notifications_instructor_id_idx" ON "instructor_notifications" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_notifications_student_id_idx" ON "instructor_notifications" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "instructor_notifications_course_id_idx" ON "instructor_notifications" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "instructor_notifications_read_at_idx" ON "instructor_notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "instructor_chat_messages_notification_id_idx" ON "instructor_chat_messages" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "instructor_chat_messages_instructor_id_idx" ON "instructor_chat_messages" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "instructor_chat_messages_student_id_idx" ON "instructor_chat_messages" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "portfolio_post_comments_post_id_idx" ON "portfolio_post_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "portfolio_posts_student_id_idx" ON "portfolio_posts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "portfolio_posts_course_id_idx" ON "portfolio_posts" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "portfolio_posts_deleted_at_idx" ON "portfolio_posts" USING btree ("deleted_at");