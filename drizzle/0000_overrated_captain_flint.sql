CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text DEFAULT 'Apple Shortcut' NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#8e8e93' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"phones" text DEFAULT '[]' NOT NULL,
	"emails" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email_address" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expiry_date" bigint,
	"history_id" text,
	"last_sync_at" bigint,
	"initial_sync_done" boolean DEFAULT false NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"total_synced" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "gmail_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"pattern" text NOT NULL,
	"category_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortcut_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"direction" text DEFAULT 'debit' NOT NULL,
	"category_id" text,
	"category_name" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched_transaction_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"gmail_message_id" text,
	"source" text DEFAULT 'gmail' NOT NULL,
	"occurred_at" bigint NOT NULL,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"direction" text NOT NULL,
	"merchant" text,
	"merchant_normalized" text,
	"channel" text,
	"bank" text,
	"reference_number" text,
	"upi_id" text,
	"card_last4" text,
	"email_subject" text,
	"confidence" double precision,
	"category_id" text,
	"notes" text,
	"raw" text,
	"duplicate_of_id" text,
	"deleted_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"password_hash" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortcut_events" ADD CONSTRAINT "shortcut_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortcut_events" ADD CONSTRAINT "shortcut_events_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_idx" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_name_idx" ON "contacts" USING btree ("user_id","name_normalized");--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rules_user_idx" ON "merchant_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shortcut_user_idx" ON "shortcut_events" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "txn_user_gmail_idx" ON "transactions" USING btree ("user_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "txn_user_time_idx" ON "transactions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "txn_user_amount_idx" ON "transactions" USING btree ("user_id","amount_paise");--> statement-breakpoint
CREATE INDEX "txn_user_category_idx" ON "transactions" USING btree ("user_id","category_id");