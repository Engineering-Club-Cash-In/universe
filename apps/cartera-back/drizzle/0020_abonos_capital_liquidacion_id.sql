-- Anota en cada abono a capital en qué liquidación se cerró.
--
-- Contexto: el reporte /reportes/reinversion-liquidaciones llegaba al abono por
-- `pagos_credito_inversionistas_espejo.abono_capital_id`. Esa columna es una sola
-- casilla: apunta a UN abono. Mientras hubo una fila por par (crédito,
-- inversionista) daba igual — ese uno era todo. Con una fila por pago (ver
-- 0019), ir por el link solo agarra la primera y el reporte subcuenta.
--
-- Con `liquidacion_id` seteado al cerrar el abono, el reporte suma directo y no
-- necesita el link ni el DISTINCT.
--
-- El backfill hace UNA vez el mismo rodeo que el reporte hacía en cada consulta,
-- y es exacto para lo viejo: en el modelo anterior había una sola fila abierta
-- por par y era justo la linkeada.

ALTER TABLE "cartera"."abonos_capital"
  ADD COLUMN IF NOT EXISTS "liquidacion_id" integer;

DO $$ BEGIN
  ALTER TABLE "cartera"."abonos_capital"
    ADD CONSTRAINT "abonos_capital_liquidacion_id_liquidaciones_liquidacion_id_fk"
    FOREIGN KEY ("liquidacion_id") REFERENCES "cartera"."liquidaciones"("liquidacion_id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ix_abonos_capital_liquidacion_id"
  ON "cartera"."abonos_capital" ("liquidacion_id");

-- Backfill del histórico: se recorre el link una sola vez y se guarda.
-- MIN() por determinismo: si un abono estuviera linkeado desde espejos de más de
-- una liquidación, se le atribuye la primera (la que efectivamente lo pagó).
UPDATE "cartera"."abonos_capital" a
   SET "liquidacion_id" = sub.liquidacion_id
  FROM (
    SELECT e."abono_capital_id" AS abono_id,
           MIN(e."liquidacion_id") AS liquidacion_id
      FROM "cartera"."pagos_credito_inversionistas_espejo" e
     WHERE e."abono_capital_id" IS NOT NULL
       AND e."liquidacion_id" IS NOT NULL
     GROUP BY e."abono_capital_id"
  ) sub
 WHERE a."abono_id" = sub.abono_id
   AND a."liquidacion_id" IS NULL;
