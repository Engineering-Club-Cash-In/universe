ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "buro_revalidacion_al_30" boolean NOT NULL DEFAULT false;

-- Las oportunidades que ya estaban en análisis antes de esta migración no
-- pasaron por la consulta obligatoria del 20%. Conservan acceso excepcional
-- a la consulta en el 30% sin retroceder de etapa.
UPDATE "opportunities"
SET "buro_revalidacion_al_30" = true
WHERE "status" IN ('open', 'on_hold')
  AND "stage_id" IN (
    SELECT "id" FROM "sales_stages" WHERE "closure_percentage" = 30
  );
