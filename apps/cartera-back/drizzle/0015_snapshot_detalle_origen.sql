-- 0015 — Desglose por origen (crédito nuevo vs pago) + separación seguro/GPS
-- Spec: docs/superpowers/specs/2026-06-18-facturacion-detalle-origen-design.md
-- NO toca totales ni fórmulas existentes: solo agrega columnas/tabla nuevas.

-- 1) Snapshot: seguro y GPS por categoría (el combinado sigue en servicios_seguro_gps)
ALTER TABLE cartera.facturacion_snapshot_diario
  ADD COLUMN IF NOT EXISTS seg_autocompras           numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seg_sobre_vehiculo        numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nuevo_seg_autocompras     numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seg_hipotecario           numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seg_extra_financiamiento  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seg_reestructura          numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seguro_total              numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gps_autocompras           numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gps_sobre_vehiculo        numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nuevo_gps_autocompras     numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gps_hipotecario           numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gps_extra_financiamiento  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gps_reestructura          numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gps_total                 numeric(18,2) NOT NULL DEFAULT 0;

-- 2) Tabla intermedia: desglose por origen (nuevo vs pago), derivada de facturacion_desglose
CREATE TABLE IF NOT EXISTS cartera.facturacion_snapshot_detalle (
  id          serial PRIMARY KEY,
  fecha       date NOT NULL,
  rubro       cartera.rubro_facturacion NOT NULL,
  producto    varchar(40) NOT NULL,   -- autocompras|sobre_vehiculo|nuevo_autocompras|hipotecario|extra_financiamiento|reestructura|sin_producto
  origen      varchar(10) NOT NULL,   -- 'nuevo' (originación) | 'pago'
  monto_total numeric(18,2) NOT NULL DEFAULT 0,
  monto_iva   numeric(18,2) NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_facturacion_snapshot_detalle
  ON cartera.facturacion_snapshot_detalle (fecha, rubro, producto, origen);
CREATE INDEX IF NOT EXISTS idx_facturacion_snapshot_detalle_fecha
  ON cartera.facturacion_snapshot_detalle (fecha);
