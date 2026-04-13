ALTER TABLE "students" ADD COLUMN "privacy_consent_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "data_deletion_requested_at" timestamp with time zone;