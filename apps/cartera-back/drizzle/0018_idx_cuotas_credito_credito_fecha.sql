-- 0018 — Índice compuesto para cuotas_credito.
-- Soporta las subconsultas correlacionadas por (credito_id, fecha_vencimiento):
-- el filtro excluir_pagados_mes de /getAllCredits y los lookups de próximas
-- cuotas. Sin esto cada evaluación cae a seq scan de la tabla completa.
--
-- Nota para aplicar EN PROD a mano: preferir CONCURRENTLY (fuera de
-- transacción) para no bloquear escrituras:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cuotas_credito_credito_fecha
--     ON cartera.cuotas_credito (credito_id, fecha_vencimiento);

CREATE INDEX IF NOT EXISTS idx_cuotas_credito_credito_fecha
  ON cartera.cuotas_credito (credito_id, fecha_vencimiento);
