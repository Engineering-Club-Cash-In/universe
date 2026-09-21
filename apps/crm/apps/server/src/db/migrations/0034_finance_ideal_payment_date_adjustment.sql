ALTER TABLE "quotations"
ADD COLUMN "ideal_payment_date_adjustment" numeric(14, 2) DEFAULT '0' NOT NULL,
ADD COLUMN "ideal_payment_date_adjustment_days" integer DEFAULT 0 NOT NULL,
ADD COLUMN "ideal_payment_date_adjustment_reference_date" date;

-- Las oportunidades IA asignadas antes de esta migración ya tienen el día
-- original, pero no la nueva fecha de referencia. Se toma la última entrada
-- registrada a 80% y se actualiza solo la cotización contractual que usa el
-- cierre: accepted primero y, si no existe, la más reciente. Los timestamps
-- históricos se guardaron como pared UTC; se convierten explícitamente al día
-- calendario de Guatemala.
WITH "latest_stage_80" AS (
  SELECT
    "history"."opportunity_id",
    max("history"."changed_at") AS "changed_at"
  FROM "opportunity_stage_history" AS "history"
  INNER JOIN "sales_stages" AS "target_stage"
    ON "target_stage"."id" = "history"."to_stage_id"
  WHERE "target_stage"."closure_percentage" = 80
  GROUP BY "history"."opportunity_id"
),
"contractual_quotations" AS (
  SELECT
    "quotation"."id",
    "stage_80"."changed_at",
    row_number() OVER (
      PARTITION BY "quotation"."opportunity_id"
      ORDER BY
        ("quotation"."status" = 'accepted') DESC,
        "quotation"."created_at" DESC
    ) AS "priority"
  FROM "quotations" AS "quotation"
  INNER JOIN "opportunities" AS "opportunity"
    ON "opportunity"."id" = "quotation"."opportunity_id"
  INNER JOIN "sales_stages" AS "current_stage"
    ON "current_stage"."id" = "opportunity"."stage_id"
  INNER JOIN "latest_stage_80" AS "stage_80"
    ON "stage_80"."opportunity_id" = "opportunity"."id"
  WHERE "opportunity"."dia_pago_original_sistema" IS NOT NULL
    AND "opportunity"."status" = 'open'
    AND "opportunity"."numero_sifco" IS NULL
    AND "current_stage"."closure_percentage" >= 80
)
UPDATE "quotations" AS "quotation"
SET "ideal_payment_date_adjustment_reference_date" = (
  (
    "contractual"."changed_at" AT TIME ZONE 'UTC'
  ) AT TIME ZONE 'America/Guatemala'
)::date
FROM "contractual_quotations" AS "contractual"
WHERE "quotation"."id" = "contractual"."id"
  AND "contractual"."priority" = 1
  AND "quotation"."ideal_payment_date_adjustment_reference_date" IS NULL;

-- Esta cotización fue corregida manualmente antes de existir las columnas de
-- trazabilidad. El guard de montos evita marcarla si fue regenerada otra vez.
UPDATE "quotations"
SET
  "ideal_payment_date_adjustment" = '1424.12',
  "ideal_payment_date_adjustment_days" = 18,
  "ideal_payment_date_adjustment_reference_date" = '2026-09-16'
WHERE "opportunity_id" = 'e9aacd24-cee9-4b95-afba-8b0f440281fe'
  AND "total_financed" = '88419.27'
  AND "admin_cost" = '8569.27'
  AND "extra_admin_cost" = '2024.12'
  AND "ideal_payment_date_adjustment" = '0';
