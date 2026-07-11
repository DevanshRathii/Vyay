ALTER TABLE "users" ADD COLUMN "gmail_access_granted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Grandfather anyone who already has a working Gmail connection (they've
-- clearly already been through Google's real Test Users gate once).
UPDATE "users" SET "gmail_access_granted" = true WHERE "id" IN (SELECT "user_id" FROM "gmail_connections");