-- Ingresos por carros (manuales, itemizados por día) para el reporte diario
-- de facturación (columna "Ingreso Carros" del Excel). El snapshot suma por día.
CREATE TABLE IF NOT EXISTS cartera.ingresos_carros (
  id          serial PRIMARY KEY,
  fecha       date NOT NULL,                       -- America/Guatemala
  concepto    varchar(200) NOT NULL,
  monto       numeric(18,2) NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now(),
  created_by  integer
);

CREATE INDEX IF NOT EXISTS idx_ingresos_carros_fecha
  ON cartera.ingresos_carros (fecha);
