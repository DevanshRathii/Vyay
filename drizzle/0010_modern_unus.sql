CREATE TABLE "parse_health_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"merchant_hits" integer DEFAULT 0 NOT NULL,
	"upi_hits" integer DEFAULT 0 NOT NULL,
	"ref_hits" integer DEFAULT 0 NOT NULL,
	"categorized_hits" integer DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "parse_health_stats_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "parse_samples" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shortcut_events" ADD COLUMN "occurred_at" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "ref_bidx" text;--> statement-breakpoint
ALTER TABLE "parse_samples" ADD CONSTRAINT "parse_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parse_samples_resolved_idx" ON "parse_samples" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "txn_user_ref_bidx_idx" ON "transactions" USING btree ("user_id","ref_bidx");