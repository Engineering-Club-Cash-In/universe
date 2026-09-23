ALTER TABLE "nexa_reviews" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nexa_reviews" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nexa_reviews" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "nexa_reviews_transaction_id_idx" ON "nexa_reviews" USING btree ("transaction_id");