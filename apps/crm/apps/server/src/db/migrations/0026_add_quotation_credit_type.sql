ALTER TABLE "quotations" ADD COLUMN "credit_type" "credit_type";
--> statement-breakpoint
UPDATE "quotations"
SET "credit_type" = CASE
	WHEN "down_payment_percentage" = 0 THEN 'sobre_vehiculo'::"credit_type"
	WHEN "down_payment_percentage" > 0 THEN 'autocompra'::"credit_type"
END
WHERE "credit_type" IS NULL;
--> statement-breakpoint
UPDATE "quotations" AS "quotation"
SET "credit_type" = "opportunity"."credit_type"
FROM "opportunities" AS "opportunity"
WHERE "quotation"."opportunity_id" = "opportunity"."id"
	AND "quotation"."credit_type" IS NULL;
--> statement-breakpoint
UPDATE "quotations"
SET "credit_type" = 'autocompra'::"credit_type"
WHERE "credit_type" IS NULL;
--> statement-breakpoint
ALTER TABLE "quotations" ALTER COLUMN "credit_type" SET DEFAULT 'autocompra';
--> statement-breakpoint
ALTER TABLE "quotations" ALTER COLUMN "credit_type" SET NOT NULL;
