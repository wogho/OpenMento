ALTER TYPE "public"."portfolio_status" ADD VALUE 'hitl_review' BEFORE 'security_review';--> statement-breakpoint
ALTER TYPE "public"."portfolio_status" ADD VALUE 'abandoned';--> statement-breakpoint
CREATE TABLE "persona_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid,
	"legacy_key" text,
	"industry" text NOT NULL,
	"role" text NOT NULL,
	"prompt" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "persona_templates" ADD CONSTRAINT "persona_templates_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_templates_institution_id_idx" ON "persona_templates" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "persona_templates_legacy_key_idx" ON "persona_templates" USING btree ("legacy_key");--> statement-breakpoint
CREATE INDEX "persona_templates_deleted_at_idx" ON "persona_templates" USING btree ("deleted_at");