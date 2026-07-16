-- Un pago aporta UNA fila por inversionista, garantizado por la base.
--
-- Hasta ahora era solo una convención del código: distribuirAbonoCapitalEspejo
-- inserta una fila por inversionista y nada impedía que corriera dos veces para
-- el mismo pago. Si dos aplicaciones del mismo pago se pisan (doble click, retry,
-- dos procesos), se duplicaban los abonos y se le restaba el capital DOS VECES al
-- inversionista. Con el índice único la segunda revienta en vez de duplicar.
--
-- Las filas con `pago_id` NULL no chocan entre sí: en Postgres los NULL no
-- colisionan en un índice único. Eso deja fuera, por diseño:
--   * las filas previas a la migración 0019 (nunca se supo qué pago las creó),
--   * las CANCELACION de devolución/reset, que no nacen de un pago.
--
-- Verificado contra prod antes de crearlo: 0 pares (pago_id, inversionista_id)
-- duplicados, así que entra sin conflictos.

CREATE UNIQUE INDEX IF NOT EXISTS "ux_abonos_capital_pago_inversionista"
  ON "cartera"."abonos_capital" ("pago_id", "inversionista_id");
