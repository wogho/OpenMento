CREATE TABLE "ews_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"warning_threshold" integer DEFAULT 60 NOT NULL,
	"high_risk_threshold" integer DEFAULT 75 NOT NULL,
	"critical_threshold" integer DEFAULT 90 NOT NULL,
	"slack_escalate_score" integer DEFAULT 75 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ews_settings_institution_id_unique" UNIQUE("institution_id")
);
--> statement-breakpoint
ALTER TABLE "ews_settings" ADD CONSTRAINT "ews_settings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;