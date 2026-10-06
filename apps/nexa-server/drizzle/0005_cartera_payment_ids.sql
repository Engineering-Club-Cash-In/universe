ALTER TABLE "nexa_payment_transactions" ADD COLUMN "cartera_payment_ids" integer[];--> statement-breakpoint
UPDATE "nexa_payment_transactions"
SET "cartera_payment_ids" = ARRAY["cartera_payment_id"]
WHERE "cartera_payment_id" IS NOT NULL AND "cartera_payment_ids" IS NULL;
