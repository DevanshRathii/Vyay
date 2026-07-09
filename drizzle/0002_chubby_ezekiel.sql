ALTER TABLE "gmail_connections" ADD COLUMN "sync_started_at" bigint;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD COLUMN "sync_progress_phase" text;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD COLUMN "sync_progress_done" integer;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD COLUMN "sync_progress_total" integer;