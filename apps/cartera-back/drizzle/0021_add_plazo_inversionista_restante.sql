-- VARIANTE 2 del plazo: cuántos meses le FALTAN al plazo propio del
-- inversionista en este crédito. Arranca igual a plazo_inversionista al
-- registrar la compra y, cuando se implemente la resta al monto del espejo,
-- cada liquidación lo decrementará en 1. El cálculo de
-- diferencia_amortizacion_plazo (pagos espejo) usa ESTA columna como n de la
-- cuota nivelada: con el saldo vigente y el plazo restante, la amortización
-- francesa recalculada mes a mes cierra exacta en n meses.
-- NULL = sin plazo propio. Cartera aplica el SQL a mano (no drizzle-kit).

ALTER TABLE cartera.creditos_inversionistas_espejo
  ADD COLUMN IF NOT EXISTS plazo_inversionista_restante integer;

-- Backfill: filas que ya tengan plazo definido arrancan con todo el plazo
-- pendiente (hoy no existe ninguna en prod; idempotente para entornos de prueba).
UPDATE cartera.creditos_inversionistas_espejo
SET plazo_inversionista_restante = plazo_inversionista
WHERE plazo_inversionista IS NOT NULL
  AND plazo_inversionista_restante IS NULL;
