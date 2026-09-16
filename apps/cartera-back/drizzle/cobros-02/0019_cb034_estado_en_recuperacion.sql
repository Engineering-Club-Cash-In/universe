-- COBROS-02 · Fase 4 — el estado `EN_RECUPERACION` y el mecanismo de PISO.
--
-- ── Por qué no sirve `estados_incluidos` ────────────────────────────────────
-- La primera idea fue meter EN_RECUPERACION en `buckets.estados_incluidos` de
-- B4, el mismo mecanismo que hoy manda INCOBRABLE a B5. NO sirve, y la razón es
-- la decisión 3 del plan 08: ese mecanismo CLAVA el bucket, y un crédito clavado
-- en B4 nunca podría subir a B5 cuando le cae la 5ª cuota.
--
-- Lo que hace falta es un PISO:
--
--     bucket = max(bucket por cuotas atrasadas, 4)   mientras esté EN_RECUPERACION
--
--        2 cuotas → max(B2, B4) = B4        4 cuotas → max(B4, B4) = B4
--        3 cuotas → max(B3, B4) = B4        5 cuotas → max(B5, B4) = B5  ← sube solo
--
-- Nunca baja de B4, sube cuando toca, y sale del piso cuando se levanta el
-- estado. Es un mecanismo NUEVO del catálogo, no el que ya existía.
--
-- ── Por qué es una columna del catálogo y no una constante ──────────────────
-- Mismo criterio que todo el resto de `cartera.buckets`: rangos, nombres,
-- colores y estados se editan sin tocar código. Si mañana el piso de
-- EN_RECUPERACION pasa a ser B3, es un UPDATE.

ALTER TABLE cartera.buckets
  ADD COLUMN IF NOT EXISTS estados_piso text[] NOT NULL DEFAULT ARRAY[]::text[];
--> statement-breakpoint

COMMENT ON COLUMN cartera.buckets.estados_piso IS
  'COBROS-02 Fase 4: estados que fijan este bucket como MINIMO (piso). Distinto de estados_incluidos, que lo CLAVA: con un piso el credito puede subir por cuotas atrasadas, pero nunca baja de aqui.';
--> statement-breakpoint

-- B4 · Última Instancia / Pre Jurídico es el piso de la recuperación de
-- vehículo. Idempotente: no duplica el valor si ya está.
UPDATE cartera.buckets
   SET estados_piso = ARRAY['EN_RECUPERACION']::text[], updated_at = now()
 WHERE numero = 4
   AND NOT ('EN_RECUPERACION' = ANY(estados_piso));
