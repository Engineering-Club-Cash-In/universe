ALTER TABLE cartera.cierre_mora_oficial
  ADD COLUMN IF NOT EXISTS porcentaje_mora numeric(5, 2) NOT NULL DEFAULT 1.12
  CHECK (porcentaje_mora > 0 AND porcentaje_mora <= 100);
