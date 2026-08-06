-- Flag de control: inversionistas a los que se les descuentan todos los
-- impuestos al liquidar. Solo flag por ahora, sin efecto en cálculos.
-- Aditiva y retrocompatible (default false).
-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).

ALTER TABLE cartera.inversionistas ADD COLUMN IF NOT EXISTS descuenta_impuestos boolean NOT NULL DEFAULT false;
