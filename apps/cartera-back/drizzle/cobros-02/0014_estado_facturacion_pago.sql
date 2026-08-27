-- 0014 · Visibilidad de la facturación: estado por pago y rubro por factura
-- ============================================================================
--
-- Decisión de Daniel 2026-08-27: NO se refactura solo (ni job ni endpoint) —
-- "no está en la DB" no prueba que no esté en SAT, y reintentar a ciegas
-- duplica DTE. Lo que sí hace falta es VER qué pago quedó sin facturar o a
-- medias, y de qué rubro/inversionista es cada factura emitida, para que
-- conta decida.
--
-- 1. `pagos_credito.factura_status` — estado de la facturación de ESE pago.
--    Deliberadamente separado de `validation_status`: un pago validado sin
--    factura sigue siendo un pago aplicado (el cron de moras, buckets y
--    reportes leen 'validated'/'no_required'; meter estados nuevos ahí
--    rompería el conteo de cuotas cubiertas).
--    NULL = pago anterior a esta feature; no se interpreta.
-- 2. `facturas_electronicas.rubro` / `inversionista_id` — qué cubre cada DTE.
--    Backfill del histórico desde facturacion_desglose (rubro); el
--    inversionista de las viejas queda NULL (no se infiere).

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

-- Backfill del histórico: facturacion_desglose ya amarra factura_id ↔ rubro
-- para las que salieron completas. Se mapean solo los rubros equivalentes;
-- el resto queda NULL (desconocido, no inventado).
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
