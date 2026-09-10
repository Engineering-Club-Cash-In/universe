-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- checkCreditHasUnliquidatedDrafts, checkInvestorHasUnliquidatedDrafts
-- (draftPaymentsGuard.ts) y el conteo de tiene_pagos_sin_liquidar en
-- getAllCredits (credits.ts) filtran pagos_credito_inversionistas_espejo por
-- credito_id/inversionista_id + estado_liquidacion != 'LIQUIDADO'. La tabla
-- solo tenía índice en liquidacion_id (idx_pagos_liquidacion_espejo) — nada
-- en credito_id ni en estado_liquidacion, así que estas consultas hacían
-- full scan. La de getAllCredits es la más sensible: corre en cada carga o
-- filtro de la pantalla principal de créditos, no solo al solicitar
-- devolución.
--
-- Parcial (WHERE estado_liquidacion <> 'LIQUIDADO'): las filas LIQUIDADO
-- crecen sin límite con el tiempo y nunca las consulta este patrón — el
-- índice completo solo indexaría ruido.
--
-- Sin CONCURRENTLY a propósito, mismo criterio que 0034_add_origen_historico
-- _monto_aportado: este archivo se ejecuta como un statement múltiple que
-- Postgres envuelve en una transacción implícita, donde CONCURRENTLY aborta
-- con "cannot run inside a transaction block" y hace rollback de toda la
-- migración.
CREATE INDEX IF NOT EXISTS ix_pcie_credito_no_liquidado
  ON cartera.pagos_credito_inversionistas_espejo (credito_id)
  WHERE estado_liquidacion <> 'LIQUIDADO';

CREATE INDEX IF NOT EXISTS ix_pcie_inversionista_no_liquidado
  ON cartera.pagos_credito_inversionistas_espejo (inversionista_id)
  WHERE estado_liquidacion <> 'LIQUIDADO';
