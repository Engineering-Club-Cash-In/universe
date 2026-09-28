-- Admin > Reportes > Cobranza consulta repetidamente pagos por cuota para
-- reconstruir el saldo al inicio de cada período.
CREATE INDEX IF NOT EXISTS idx_pagos_credito_cuota
  ON cartera.pagos_credito (cuota_id);
