-- Snapshot por liquidación del flag descuenta_impuestos del inversionista.
-- Fija CÓMO se pagó cada liquidación (neto ×0.81 vs bruto) para no recalcular
-- el histórico con el flag actual del inversionista.
-- Aditiva y retrocompatible: las liquidaciones existentes quedan en false
-- (fórmula bruta original, que es como se pagaron).
-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).

ALTER TABLE cartera.liquidaciones ADD COLUMN IF NOT EXISTS descuenta_impuestos boolean NOT NULL DEFAULT false;
