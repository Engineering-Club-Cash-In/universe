-- Plazo propio del inversionista (en meses): en cuánto tiempo saca su inversión.
-- Hoy el abono a capital se deriva del plazo del crédito; esta columna guarda el
-- plazo que el inversionista define al hacer la compra de cartera / reinversión.
-- Por ahora SOLO se persiste (front -> backend -> insert); la lógica de cálculo
-- que lo use vendrá después.
--
-- Nullable a propósito: los registros históricos no tienen plazo propio y la
-- lógica actual (plazo del crédito) sigue aplicando cuando es NULL.
-- Cartera aplica el SQL a mano (no drizzle-kit).

ALTER TABLE cartera.creditos_inversionistas_espejo
  ADD COLUMN IF NOT EXISTS plazo_inversionista integer;

ALTER TABLE cartera.compras_credito_inversionista
  ADD COLUMN IF NOT EXISTS plazo_inversionista integer;
