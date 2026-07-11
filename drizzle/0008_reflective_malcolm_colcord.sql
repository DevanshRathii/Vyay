-- Pre-existing gap unrelated to this migration's own purpose: 0005 assumed
-- feedback_messages already existed (it did, in prod, via an out-of-band
-- preview build — see that file's comment) and never actually creates it.
-- Any from-scratch replay (fresh self-host, PGlite tests) never gets this
-- table. Fixed here, guarded, since prior migrations are append-only and
-- must not be edited.
CREATE TABLE IF NOT EXISTS "feedback_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.table_constraints
    WHERE constraint_name = 'feedback_messages_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "feedback_messages"
      ADD CONSTRAINT "feedback_messages_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_user_idx" ON "feedback_messages" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "shortcut_events" ALTER COLUMN "amount_paise" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount_paise" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shortcut_events" ADD COLUMN "enc_payload" text;--> statement-breakpoint
ALTER TABLE "shortcut_events" ADD COLUMN "amount_bidx" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "enc_payload" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "amount_bidx" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "key_check" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "key_created_at" bigint;--> statement-breakpoint
CREATE INDEX "txn_user_bidx_idx" ON "transactions" USING btree ("user_id","amount_bidx");--> statement-breakpoint
-- Zero-access encryption is only half the trust story: also close Supabase's
-- auto-generated PostgREST/Data-API surface so `anon`/`authenticated` can't
-- read tables directly. The app's own connection (table owner) bypasses RLS
-- and is unaffected. PGlite's test harness has no anon/authenticated roles,
-- so guard the REVOKE with an existence check to keep migration replay green
-- in tests.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gmail_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shortcut_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedback_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "preapproved_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
  END IF;
END $$;