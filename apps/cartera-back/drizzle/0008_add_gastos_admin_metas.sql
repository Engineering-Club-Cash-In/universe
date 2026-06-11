-- Gastos administrativos (manuales, itemizados por día) y metas financieras
-- (manuales, por año/mes) para el reporte diario de facturación.

-- 🧾 Gastos administrativos: varios por día (concepto + monto). El reporte suma por día.
CREATE TABLE IF NOT EXISTS cartera.gastos_administrativos (
  id          serial PRIMARY KEY,
  fecha       date NOT NULL,                       -- fecha del gasto (America/Guatemala)
  concepto    varchar(200) NOT NULL,
  monto       numeric(18,2) NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now(),
  created_by  integer
);

CREATE INDEX IF NOT EXISTS idx_gastos_admin_fecha
  ON cartera.gastos_administrativos (fecha);

-- 🎯 Metas financieras por (año, mes). Globales (no por categoría).
--    meta_mensual/semanal/diaria capturadas por separado; deuda_* opcionales.
CREATE TABLE IF NOT EXISTS cartera.metas_facturacion (
  id             serial PRIMARY KEY,
  anio           integer NOT NULL,
  mes            integer NOT NULL,                 -- 1-12
  meta_mensual   numeric(18,2) NOT NULL DEFAULT 0,
  meta_semanal   numeric(18,2) NOT NULL DEFAULT 0,
  meta_diaria    numeric(18,2) NOT NULL DEFAULT 0, -- aplica a cada día del mes
  deuda_mensual  numeric(18,2),
  deuda_semanal  numeric(18,2),
  deuda_diaria   numeric(18,2),
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

-- 1 fila por (año, mes) -> permite upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_metas_facturacion_anio_mes
  ON cartera.metas_facturacion (anio, mes);
