-- Enlaza cada abono a capital con el pago que lo generó.
--
-- Contexto: hasta ahora `abonos_capital` era un ACUMULADO — una fila por par
-- (credito_id, inversionista_id) sobre la que cada pago sumaba su monto. Por eso
-- al revertir un pago no se podía saber qué parte de la fila era suya, y el
-- monto quedaba sumado para siempre (abono huérfano).
--
-- Ahora cada pago inserta su propia fila con su `pago_id`, y revertir el pago
-- borra exactamente esas filas.
--
-- NULLABLE a propósito:
--   * las filas que ya existen (no se puede reconstruir qué pagos las formaron:
--     esa información nunca se guardó),
--   * las CANCELACION de devolución/reset, que no nacen de un pago,
--   * el alta manual por POST /api/abonos-capital.
--
-- ON DELETE CASCADE: reversePayment borra los pagos parciales; sin el cascade su
-- abono quedaría huérfano apuntando a un pago inexistente.

ALTER TABLE "cartera"."abonos_capital"
  ADD COLUMN IF NOT EXISTS "pago_id" integer;

DO $$ BEGIN
  ALTER TABLE "cartera"."abonos_capital"
    ADD CONSTRAINT "abonos_capital_pago_id_pagos_credito_pago_id_fk"
    FOREIGN KEY ("pago_id") REFERENCES "cartera"."pagos_credito"("pago_id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ix_abonos_capital_pago_id"
  ON "cartera"."abonos_capital" ("pago_id");

CREATE INDEX IF NOT EXISTS "ix_abonos_capital_cred_inv"
  ON "cartera"."abonos_capital" ("credito_id", "inversionista_id");
