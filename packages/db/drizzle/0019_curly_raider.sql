ALTER TYPE "public"."heartbeat_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."heartbeat_status" ADD VALUE 'timed_out';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_session_params_json" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_session_display_id" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "invocation_source" text DEFAULT 'timer' NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "trigger_detail" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "context_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "session_id_before" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "session_id_after" text;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "error_code" text;