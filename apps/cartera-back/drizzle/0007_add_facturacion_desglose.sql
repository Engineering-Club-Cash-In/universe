-- Desglose por rubro de LO QUE FACTURA CUBE en cada pago, para el reporte
-- diario de facturación (matriz categoría × rubro × día).
--   - 1 fila por (pago_id, rubro).
--   - INTERES = residuo CUBE CON IVA (totalCube de /facturar-pago-completo).
--   - CAPITAL no se factura -> factura_id NULL, monto_iva 0.
--   - monto_total incluye IVA (misma convención que facturas_electronicas).
--   - fecha_aplicado_gt = fecha_aplicado del pago en zona America/Guatemala.
--   - La categoría NO se guarda: sale por JOIN pago -> crédito -> usuario.

DO $$ BEGIN
  CREATE TYPE cartera.rubro_facturacion AS ENUM (
    'CAPITAL','INTERES','MEMBRESIA','SEGURO','GPS','MORA','OTROS'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS cartera.facturacion_desglose (
  id                serial PRIMARY KEY,
  pago_id           integer NOT NULL REFERENCES cartera.pagos_credito(pago_id) ON DELETE CASCADE,
  factura_id        integer REFERENCES cartera.facturas_electronicas(factura_id) ON DELETE SET NULL,
  rubro             cartera.rubro_facturacion NOT NULL,
  monto_total       numeric(18,2) NOT NULL DEFAULT 0,   -- con IVA incluido
  monto_iva         numeric(18,2) NOT NULL DEFAULT 0,
  fecha_aplicado_gt date,                                -- fecha_aplicado en America/Guatemala
  created_at        timestamp NOT NULL DEFAULT now()
);

-- 1 fila por (pago, rubro) -> permite upsert idempotente al re-facturar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturacion_desglose_pago_rubro
  ON cartera.facturacion_desglose (pago_id, rubro);

-- El reporte filtra por día.
CREATE INDEX IF NOT EXISTS idx_facturacion_desglose_fecha
  ON cartera.facturacion_desglose (fecha_aplicado_gt);