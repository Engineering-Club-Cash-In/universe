-- Congela el reparto de interés por inversionista en el momento de FACTURAR.
--
-- Problema que resuelve:
--   Un pago PARCIAL no crea filas en `pagos_credito_inversionistas` (pci) — el
--   reparto real se escribe hasta que la cuota se COMPLETA. Mientras tanto, el
--   reporte de pagos lo SIMULA con `creditos_inversionistas` (el roster VIVO), y
--   `insertPagosCreditoInversionistasV2` también lo recalcula con el roster vivo
--   al cerrar la cuota.
--
--   Si entre el parcial y el cierre cambia el roster (reinversión, compra de
--   cartera, abono a capital), el mismo pago pasa a repartirse distinto — pero la
--   factura ya emitida NO cambia. Caso real: crédito 01010214118190, pago 152741
--   (7-ago-2026). Se facturó Q6.42 al inversionista; el 10-ago entró una
--   reinversión de Q3,396.05 que subió su `monto_aportado` de 7,727.14 a
--   11,123.19, y desde entonces el reporte muestra Q9.24 para ese mismo pago.
--
-- Qué guarda:
--   El resultado de `calcularSplitInteresPci` (la MISMA función pura que usan el
--   reporte y el cierre) evaluado con el roster del día de la facturación, más el
--   roster mismo, para que la fila sea auditable sin depender del estado actual.
--
-- Una fila por (pago_id, inversionista_id), incluyendo a CUBE: así el cierre puede
-- congelar el reparto COMPLETO y no solo la parte de los inversionistas.
--
-- Se escribe una sola vez (ON CONFLICT DO NOTHING en el insert): re-facturar no
-- vuelve a congelar, porque lo que se busca preservar es el reparto del día en que
-- se emitieron los DTEs.
--
-- ON DELETE CASCADE en pago_id: reversePayment borra pagos; el congelado de un
-- pago inexistente no tiene sentido.

CREATE TABLE IF NOT EXISTS "cartera"."pagos_credito_inversionistas_facturado" (
  "id" serial PRIMARY KEY,

  -- ON DELETE CASCADE: reversePayment borra pagos; el congelado de un pago que ya
  -- no existe no tiene sentido. Las otras dos FK solo validan que el crédito y el
  -- inversionista existan — no modifican esas tablas.
  "pago_id" integer NOT NULL
    REFERENCES "cartera"."pagos_credito"("pago_id") ON DELETE CASCADE,
  "credito_id" integer NOT NULL
    REFERENCES "cartera"."creditos"("credito_id"),
  "inversionista_id" integer NOT NULL
    REFERENCES "cartera"."inversionistas"("inversionista_id"),

  -- Reparto congelado (lo que se facturó ese día)
  "abono_interes" numeric(18,2) NOT NULL DEFAULT 0,
  "abono_iva_12" numeric(18,2) NOT NULL DEFAULT 0,

  -- Roster con el que se calculó (para auditar la fila sin adivinar)
  "monto_aportado" numeric(18,8) NOT NULL DEFAULT 0,
  "porcentaje_participacion" numeric(18,10) NOT NULL DEFAULT 0,
  "porcentaje_cash_in" numeric(18,10) NOT NULL DEFAULT 0,

  -- Su interés se redirigió a CUBE en la facturación (bandera_reinversion +
  -- espejo pendiente). El reporte NO debe mostrar su fila.
  "redirigido_a_cube" boolean NOT NULL DEFAULT false,

  "created_at" timestamp NOT NULL DEFAULT now(),

  -- Un inversionista se congela UNA vez por pago (es lo que hace funcionar el
  -- ON CONFLICT DO NOTHING del insert en cofidi).
  CONSTRAINT "uq_pcif_pago_inversionista" UNIQUE ("pago_id", "inversionista_id")
);

CREATE INDEX IF NOT EXISTS "ix_pcif_pago_id"
  ON "cartera"."pagos_credito_inversionistas_facturado" ("pago_id");
