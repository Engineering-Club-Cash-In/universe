ALTER TABLE "co_debtors" ADD COLUMN IF NOT EXISTS "es_representante_legal" boolean NOT NULL DEFAULT false;

-- Un solo representante legal por oportunidad: marcar a otro le quita la marca
-- al anterior (lo hace el CRM en la misma transacción).
CREATE UNIQUE INDEX IF NOT EXISTS "co_debtors_representante_legal_uq"
  ON "co_debtors" ("opportunity_id")
  WHERE "es_representante_legal";

-- Hasta ahora ventas cargaba a la empresa como lead y a su representante legal
-- como codeudor, sin marcarlo. Donde el lead es una empresa y hay un solo
-- codeudor, ese es el representante. Con dos o más no se puede saber cuál es:
-- quedan sin marcar y el CRM pide que lo marquen.
UPDATE "co_debtors"
SET "es_representante_legal" = true
WHERE NOT "es_representante_legal"
  AND "opportunity_id" IN (
    SELECT "o"."id"
    FROM "opportunities" "o"
    INNER JOIN "leads" "l" ON "l"."id" = "o"."lead_id"
    WHERE "l"."client_type" = 'empresa'
  )
  AND "opportunity_id" IN (
    SELECT "opportunity_id"
    FROM "co_debtors"
    GROUP BY "opportunity_id"
    HAVING count(*) = 1
  );
