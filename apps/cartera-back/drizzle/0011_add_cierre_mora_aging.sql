-- Aging de mora: foto por periodo agrupando los créditos morosos por cuotas atrasadas.
-- Buckets: 30 (1 cuota), 60 (2 cuotas), 90 (3 cuotas), 120 (4 o más cuotas).
-- Una fila por (periodo, bucket). Se llena junto con cierre_mensual (mismo filtro por fecha_creacion).
CREATE TABLE IF NOT EXISTS cartera.cierre_mora_aging (
  id                 serial PRIMARY KEY,
  periodo            date NOT NULL,                       -- primer día del mes cerrado, ej. 2026-06-01
  bucket             text NOT NULL,                       -- '30' | '60' | '90' | '120'
  cuotas_min         integer NOT NULL,                    -- 1 | 2 | 3 | 4 (mínimo de cuotas atrasadas del bucket)
  cantidad_creditos  integer NOT NULL DEFAULT 0,          -- créditos morosos en el bucket (dedup por crédito)
  monto_mora         numeric(18,2) NOT NULL DEFAULT 0,    -- suma de monto_mora del bucket
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia: una sola fila por (periodo, bucket) -> permite upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_mora_aging_periodo_bucket
  ON cartera.cierre_mora_aging (periodo, bucket);
