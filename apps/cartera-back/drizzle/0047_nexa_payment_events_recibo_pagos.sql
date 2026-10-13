-- 🔴 ORDEN DE DESPLIEGUE — esta migración va a producción ANTES que el código.
-- drizzle pide la columna en cada SELECT/UPDATE de `nexa_payment_events`; si
-- el código sale primero, los pagos de Nexa fallan con
-- "column recibo_pagos_ok does not exist".
--
-- Recibos de Nexa enviados, por pago
--
-- Un evento de Nexa puede crear varias filas de pago, y el recibo se manda
-- uno por `pago_id`. Si se mandaban los dos primeros y fallaba el tercero, el
-- evento quedaba FALLIDO y el reintento volvía a mandar los tres. Esta
-- columna guarda qué pagos ya recibieron su recibo, para que el reintento
-- mande solo los que faltan. Complementa la 0046 (ya en producción).

ALTER TABLE cartera.nexa_payment_events
  ADD COLUMN IF NOT EXISTS recibo_pagos_ok integer[] NOT NULL DEFAULT '{}'::integer[];
