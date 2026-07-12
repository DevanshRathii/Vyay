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
ALTER TABLE "parse_samples" ADD CONSTRAINT "parse_samples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parse_samples_resolved_idx" ON "parse_samples" USING btree ("resolved");--> statement-breakpoint
-- Same PostgREST/Data-API lockdown as migration 0008, extended to these two
-- new tables. PGlite's test harness has no anon/authenticated roles, so
-- guard with an existence check to keep migration replay green in tests.
ALTER TABLE "parse_health_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parse_samples" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON parse_health_stats, parse_samples FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON parse_health_stats, parse_samples FROM authenticated;
  END IF;
END $$;