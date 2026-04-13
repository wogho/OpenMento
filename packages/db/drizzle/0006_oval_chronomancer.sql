CREATE TABLE "model_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_per_1k" real NOT NULL,
	"output_per_1k" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_pricing_provider_model_uidx" UNIQUE("provider","model")
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "budget_paused_at" timestamp with time zone;