ALTER TABLE "credit_analysis" ADD COLUMN "opportunity_id" uuid;
--> statement-breakpoint
ALTER TABLE "credit_analysis" DROP CONSTRAINT IF EXISTS "credit_analysis_lead_id_unique";
--> statement-breakpoint
ALTER TABLE "credit_analysis"
	ADD CONSTRAINT "credit_analysis_opportunity_id_opportunities_id_fk"
	FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_analysis_opportunity_id_unique"
	ON "credit_analysis" USING btree ("opportunity_id")
	WHERE "opportunity_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "credit_analysis" AS "analysis"
SET "opportunity_id" = "opportunity"."id"
FROM "opportunities" AS "opportunity"
WHERE "analysis"."co_debtor_id" IS NULL
	AND "opportunity"."lead_id" = "analysis"."lead_id"
	AND (
		SELECT count(*)
		FROM "opportunities" AS "candidate"
		WHERE "candidate"."lead_id" = "analysis"."lead_id"
	) = 1;

-- Resolución manual: los análisis de leads sin oportunidades o con varias permanecen en NULL.
-- Vincúlelos solo tras confirmar la oportunidad correcta; no infiera por fechas, montos ni orden.
