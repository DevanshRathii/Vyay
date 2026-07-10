ALTER TABLE "transactions" ADD COLUMN "merchant_source" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_confidence" double precision;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_source" text;