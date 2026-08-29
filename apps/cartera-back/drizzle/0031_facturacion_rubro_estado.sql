-- 0031 · Facturación: rubro por factura, estado por pago y re-facturación parcial
-- ============================================================================
--
-- UNIFICADA con `drizzle/cobros-02/0014_estado_facturacion_pago.sql` (Daniel,
-- 2026-08-27, PR #1485 en COBROS-02): mismos nombres de columnas y constraints,
-- así ambas migraciones son mutuamente idempotentes y el merge de COBROS-02 no
-- deja columnas duplicadas. Esta versión agrega además lo que la 0014 no tiene:
-- el FK de inversionista_id y el índice (pago_id, rubro) que usa el diff de
-- re-facturación (src/cofidi/facturasFaltantes.ts).
--
-- 1. `pagos_credito.factura_status` — estado de la facturación de ESE pago
--    (NO_APLICA | PENDIENTE | OK | PARCIAL | FALLIDA). Deliberadamente separado
--    de `validation_status`: un pago validado sin factura sigue siendo un pago
--    aplicado. NULL = pago anterior a esta feature; no se interpreta.
-- 2. `facturas_electronicas.rubro` / `inversionista_id` — qué cubre cada DTE
--    ('MORA' | 'OTROS_SERVICIOS' | 'OTROS' | 'INTERESES' | 'INTERESES_CUBE').
--    Lo llena /facturar-pago-completo al emitir; alimenta el diff que permite
--    re-facturar SOLO los rubros faltantes cuando una corrida sale a medias.
--    El histórico se etiqueta con src/scripts/backfill-rubro-facturas.ts
--    (dry-run + CSV para conta ANTES de --apply).
--
-- Es texto + CHECK y no enum de pg a propósito: agregar un valor nuevo es un
-- DROP+ADD del constraint, sin ALTER TYPE (que no corre en transacción). Un typo
-- en un repair manual revienta al escribir con error claro, no días después.

BEGIN;

ALTER TABLE cartera.pagos_credito
  ADD COLUMN IF NOT EXISTS factura_status text,
  ADD COLUMN IF NOT EXISTS factura_error text,
  ADD COLUMN IF NOT EXISTS factura_at timestamptz;

ALTER TABLE cartera.pagos_credito
  DROP CONSTRAINT IF EXISTS pagos_credito_factura_status_chk;

ALTER TABLE cartera.pagos_credito
  ADD CONSTRAINT pagos_credito_factura_status_chk CHECK (
    factura_status IS NULL
    OR factura_status IN ('NO_APLICA', 'PENDIENTE', 'OK', 'PARCIAL', 'FALLIDA')
  );

-- Para la bandeja "pagos con factura pendiente" de conta.
CREATE INDEX IF NOT EXISTS pagos_credito_factura_status_idx
  ON cartera.pagos_credito (factura_status)
  WHERE factura_status IN ('PENDIENTE', 'PARCIAL', 'FALLIDA');

ALTER TABLE cartera.facturas_electronicas
  ADD COLUMN IF NOT EXISTS rubro text,
  ADD COLUMN IF NOT EXISTS inversionista_id integer;

ALTER TABLE cartera.facturas_electronicas
  DROP CONSTRAINT IF EXISTS facturas_electronicas_rubro_chk;

ALTER TABLE cartera.facturas_electronicas
  ADD CONSTRAINT facturas_electronicas_rubro_chk CHECK (
    rubro IS NULL
    OR rubro IN ('MORA', 'OTROS_SERVICIOS', 'OTROS', 'INTERESES', 'INTERESES_CUBE')
  );

-- FK de inversionista_id (la 0014 no lo trae): solo valida que el inversionista
-- exista; sin ON DELETE. conrelid calificado: sin él, un constraint homónimo en
-- CUALQUIER otra tabla del cluster haría que este FK nunca se cree, en silencio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_facturas_electronicas_inversionista'
      AND conrelid = 'cartera.facturas_electronicas'::regclass
  ) THEN
    ALTER TABLE cartera.facturas_electronicas
      ADD CONSTRAINT fk_facturas_electronicas_inversionista
      FOREIGN KEY (inversionista_id)
      REFERENCES cartera.inversionistas(inversionista_id);
  END IF;
END $$;

-- El diff de re-facturación (y los GET de facturas por pago) filtran por
-- pago_id + status: el índice sigue al PREDICADO real, no a las columnas que
-- solo se leen en el SELECT.
CREATE INDEX IF NOT EXISTS idx_facturas_pago_status
  ON cartera.facturas_electronicas (pago_id, status);

-- Backfill del histórico (de la 0014): facturacion_desglose ya amarra
-- factura_id ↔ rubro para las que salieron completas (en la práctica, las
-- GENÉRICAS: las filas ligadas a un pago tienen factura_id NULL). Se mapean solo
-- los rubros equivalentes; el resto queda NULL (desconocido, no inventado). El
-- histórico grande lo cubre el script de backfill con matching por monto.
UPDATE cartera.facturas_electronicas f
SET rubro = m.rubro_factura
FROM (
  SELECT DISTINCT ON (d.factura_id)
    d.factura_id,
    -- `d.rubro` es el enum cartera.rubro_facturacion (CAPITAL, INTERES,
    -- MEMBRESIA, SEGURO, GPS, MORA, OTROS, INTERES_INVERSIONISTAS, ROYALTY);
    -- se compara como texto para no depender de sus valores exactos.
    CASE
      WHEN d.rubro::text = 'MORA' THEN 'MORA'
      WHEN d.rubro::text IN ('SEGURO', 'GPS', 'MEMBRESIA') THEN 'OTROS_SERVICIOS'
      WHEN d.rubro::text IN ('INTERES', 'INTERES_INVERSIONISTAS') THEN 'INTERESES'
      WHEN d.rubro::text = 'OTROS' THEN 'OTROS'
      ELSE NULL
    END AS rubro_factura
  FROM cartera.facturacion_desglose d
  WHERE d.factura_id IS NOT NULL
  ORDER BY d.factura_id, d.id
) m
WHERE f.factura_id = m.factura_id
  AND f.rubro IS NULL
  AND m.rubro_factura IS NOT NULL;

COMMIT;

-- ============================================================================
-- WRITE-AHEAD DE CERTIFICACIÓN (r16 del review): la intención de emitir se
-- persiste ANTES de llamar a SAT y se borra al quedar la fila en
-- facturas_electronicas. Un intento huérfano = "SAT pudo certificar y no hay
-- fila" con evidencia DURABLE: sobrevive crash duro (OOM/deploy/kill, donde ni
-- el catch corre) y no vive en factura_error (que otros flujos reescriben).
-- /facturar-pago-completo responde 409 mientras el pago tenga intentos
-- huérfanos; se reconcilian con consultarPorIdInterno (COFIDI) — por eso
-- facturas_electronicas ahora guarda id_interno: si la fila aparece (incluso
-- recuperada a mano), el intento se limpia solo.
BEGIN;

CREATE TABLE IF NOT EXISTS cartera.facturacion_intentos (
  intento_id serial PRIMARY KEY,
  pago_id integer NOT NULL,
  rubro text NOT NULL,
  inversionista_id integer,
  id_interno text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facturacion_intentos_pago
  ON cartera.facturacion_intentos (pago_id);

ALTER TABLE cartera.facturas_electronicas
  ADD COLUMN IF NOT EXISTS id_interno text;

COMMIT;

-- r21: los rechazos definitivos de COFIDI se MARCAN (no se borran) — dejan de
-- bloquear (el candado solo mira PENDIENTE) pero quedan como evidencia durable
-- de intención para la regla (f) del diff, inmune a crashes entre el rechazo y
-- la escritura de factura_error. Se limpian cuando el rubro por fin se emite.
ALTER TABLE cartera.facturacion_intentos
  ADD COLUMN IF NOT EXISTS resultado text NOT NULL DEFAULT 'PENDIENTE';
