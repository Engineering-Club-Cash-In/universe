-- Marca qué fila de espejo consumió cada abono a capital.
--
-- Por qué: el espejo CONGELA el monto a pagar cuando se genera, y no se regenera
-- mientras haya uno sin liquidar. La liquidación paga esa foto
-- (`espejo.abono_capital`). Un abono que nace DESPUÉS de la foto NO está en ese
-- monto: no se pagó. Cerrarlo igual lo daría por cobrado y el inversionista
-- nunca vería esa plata.
--
-- Con `pago_espejo_id` la liquidación cierra exactamente los abonos que la foto
-- incluyó. Los que nacieron después quedan sin marca → abiertos → los toma el
-- siguiente calcular pagos, que es como debe funcionar.
--
-- Se setea en insertPagosCreditoInversionistas (payments.ts) al generar el espejo.

ALTER TABLE "cartera"."abonos_capital"
  ADD COLUMN IF NOT EXISTS "pago_espejo_id" integer;

DO $$ BEGIN
  ALTER TABLE "cartera"."abonos_capital"
    ADD CONSTRAINT "abonos_capital_pago_espejo_id_pagos_credito_inversionistas_espejo_id_fk"
    FOREIGN KEY ("pago_espejo_id") REFERENCES "cartera"."pagos_credito_inversionistas_espejo"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ix_abonos_capital_pago_espejo_id"
  ON "cartera"."abonos_capital" ("pago_espejo_id");

-- Backfill. CRÍTICO para los abonos ABIERTOS que ya están dentro de un espejo
-- NO_LIQUIDADO: si quedaran sin marca, la liquidación (que ahora cierra solo los
-- marcados) no los cerraría nunca y el siguiente ciclo se los volvería a pagar al
-- inversionista.
--
-- Se usa el link `espejo.abono_capital_id`, que para los datos previos es
-- completo: en el modelo viejo había UNA sola fila abierta por par
-- (crédito, inversionista) y era justo la linkeada. Los abonos sin link son los
-- que ningún espejo consumió todavía: quedan en NULL, que es lo correcto.
UPDATE "cartera"."abonos_capital" a
   SET "pago_espejo_id" = e."id"
  FROM "cartera"."pagos_credito_inversionistas_espejo" e
 WHERE e."abono_capital_id" = a."abono_id"
   AND a."pago_espejo_id" IS NULL;
