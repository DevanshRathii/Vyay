ALTER TABLE "transactions" ADD COLUMN "ref_bidx" text;--> statement-breakpoint
CREATE INDEX "txn_user_ref_bidx_idx" ON "transactions" USING btree ("user_id","ref_bidx");