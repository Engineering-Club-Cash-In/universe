-- Cierre mensual de cartera: foto del estado por cada statusCredit.
-- El job corre el día 5 de cada mes y `periodo` apunta al mes anterior (el que se cierra).
CREATE TABLE IF NOT EXISTS cartera.cierre_mensual (
  id                 serial PRIMARY KEY,
  periodo            date NOT NULL,                       -- primer día del mes cerrado, ej. 2026-05-01
  status_credit      text NOT NULL,
  cantidad_creditos  integer NOT NULL DEFAULT 0,
  capital_total      numeric(18,2) NOT NULL DEFAULT 0,    -- suma del campo capital (monto colocado) por estado
  creditos_con_mora  integer NOT NULL DEFAULT 0,          -- créditos del estado con mora activa
  capital_en_mora    numeric(18,2) NOT NULL DEFAULT 0,    -- capital de los créditos en mora
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia del job: una sola fila por (periodo, estado) -> permite upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_mensual_periodo_status
  ON cartera.cierre_mensual (periodo, status_credit);
