ALTER TABLE "quotations"
ADD COLUMN "ideal_payment_date_adjustment" numeric(14, 2) DEFAULT '0' NOT NULL,
ADD COLUMN "ideal_payment_date_adjustment_days" integer DEFAULT 0 NOT NULL;

-- Esta cotización fue corregida manualmente antes de existir las columnas de
-- trazabilidad. El guard de montos evita marcarla si fue regenerada otra vez.
UPDATE "quotations"
SET
  "ideal_payment_date_adjustment" = '1424.12',
  "ideal_payment_date_adjustment_days" = 18
WHERE "opportunity_id" = 'e9aacd24-cee9-4b95-afba-8b0f440281fe'
  AND "total_financed" = '88419.27'
  AND "admin_cost" = '8569.27'
  AND "extra_admin_cost" = '2024.12'
  AND "ideal_payment_date_adjustment" = '0';
