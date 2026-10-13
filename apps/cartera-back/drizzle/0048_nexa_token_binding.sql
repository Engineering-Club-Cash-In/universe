-- Token de Nexa por crédito, en la tabla de bindings que ya existe.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Va a producción ANTES que el código que la lee o escribe. Es aditiva: las
-- columnas nuevas admiten NULL, así que el código anterior sigue funcionando
-- igual mientras tanto.
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- Hasta hoy cartera no sabía qué token de Nexa tiene cada crédito: ese dato
-- vivía solo en la base de nexa-server (`nexa_token_users`). Sin él, cartera no
-- puede comprobar que un pago que llega de Nexa corresponde al token del
-- crédito, ni mostrar el token en sus pantallas.
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
-- • Todas las columnas admiten NULL: los bindings existentes quedan sin token
--   hasta que se migren desde nexa-server.
-- • El token es único entre los bindings que lo tienen (índice parcial): un
--   mismo token nunca puede quedar ligado a dos créditos.
-- • La tabla tiene pocas filas, así que el índice se crea sin CONCURRENTLY.
--
-- ── CONVIVE CON 0045_nexa_cuenta_cliente (stack de Daniel) ─────────────────
-- Esa migración va ANTES que esta y ya agrega `nexa_token`, `nexa_identifier`
-- y `nexa_user_id` (como text/integer) con su propio índice único parcial
-- `nexa_credit_bindings_uq_token`. Esta migración corre bien con o sin ella:
-- • Cada columna va con ADD COLUMN IF NOT EXISTS: si ya existe, se queda con
--   el tipo que tenga (no se cambia ningún tipo existente).
-- • El índice único sobre `nexa_token` solo se crea si la tabla no tiene ya un
--   índice único sobre esa columna, para no duplicarlo.
-- • Es idempotente: correrla dos veces no cambia nada.

ALTER TABLE cartera.nexa_credit_bindings
  ADD COLUMN IF NOT EXISTS nexa_token VARCHAR(32),
  ADD COLUMN IF NOT EXISTS nexa_identifier VARCHAR(9),
  ADD COLUMN IF NOT EXISTS nexa_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS token_registrado_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid = 'cartera.nexa_credit_bindings'::regclass
      AND i.indisunique
      AND i.indnatts = 1
      AND a.attname = 'nexa_token'
  ) THEN
    CREATE UNIQUE INDEX uq_nexa_credit_bindings_token
      ON cartera.nexa_credit_bindings (nexa_token)
      WHERE nexa_token IS NOT NULL;
  END IF;
END
$$;
