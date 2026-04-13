CREATE TYPE "public"."agent_status" AS ENUM('idle', 'running', 'paused', 'error', 'terminated');--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "capabilities" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "status" "agent_status" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "budget_monthly_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "spent_monthly_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "pause_reason" text;