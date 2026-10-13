-- Cola de eventos hacia nexa-server (outbox).
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Va a producción ANTES que el código que escribe en ella. Es una tabla nueva:
-- el código anterior no la conoce y sigue funcionando igual.
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- Cuando un crédito pasa a CANCELADO su token de Nexa queda desactivado y
-- nexa-server debe enterarse. El evento se anota aquí dentro de la MISMA
-- transacción que la cancelación (si la cancelación se revierte, el evento
-- también), y un worker lo entrega después con reintentos.
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
-- • event_id es único: nexa-server lo usa para ignorar entregas repetidas.
-- • El índice parcial solo cubre lo pendiente, que es lo único que el worker lee.
-- • Tabla nueva y vacía: el índice se crea sin CONCURRENTLY.

CREATE TABLE IF NOT EXISTS cartera.nexa_outbox (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tipo varchar(40) NOT NULL,
  credito_id integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  intentos integer NOT NULL DEFAULT 0,
  ultimo_error text,
  proximo_intento_at timestamptz NOT NULL DEFAULT now(),
  enviado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nexa_outbox_pendientes
  ON cartera.nexa_outbox (proximo_intento_at)
  WHERE enviado_at IS NULL;

-- ── BACKFILL: bindings activos de créditos que YA estaban CANCELADO ─────────
-- Antes de este cambio el registro de token aceptaba cualquier crédito y
-- creaba el binding activo, y las cancelaciones no tocaban el binding: puede
-- haber bindings activos de créditos CANCELADO. El código nuevo solo actúa en
-- cancelaciones futuras, así que aquí se hace lo mismo que hace
-- desactivarNexaPorCancelacion (nexaCancelacion.ts): desactivar el binding y
-- encolar 'credit_cancelled' con el mismo payload, en un solo statement.
-- Idempotente: una segunda corrida ya no encuentra bindings activos de
-- cancelados, y NOT EXISTS evita un segundo evento para el mismo crédito.
WITH desactivado AS (
  UPDATE cartera.nexa_credit_bindings b
     SET activo = false
    FROM cartera.creditos c
   WHERE c.credito_id = b.credito_id
     AND c."statusCredit" = 'CANCELADO'
     AND b.activo
  RETURNING b.credito_id
)
INSERT INTO cartera.nexa_outbox (tipo, credito_id, payload)
SELECT 'credit_cancelled', d.credito_id, jsonb_build_object('creditoId', d.credito_id)
  FROM desactivado d
 WHERE NOT EXISTS (
   SELECT 1 FROM cartera.nexa_outbox o
    WHERE o.tipo = 'credit_cancelled' AND o.credito_id = d.credito_id
 );
