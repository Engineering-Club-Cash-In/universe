-- Avisos al CRM de "compra aceptada" que no llegaron.
--
-- Al aceptar una compra de cartera, cartera le avisa al CRM para que le abra a
-- jurídico la batería de contratos. Si el CRM no contesta, la compra ya quedó
-- aceptada y sale de "pendientes": sin esto no había forma de reenviar el
-- aviso y jurídico nunca se enteraba. El aviso se guarda acá y una tarea lo
-- reintenta cada 10 minutos hasta que el CRM lo acepta (es idempotente del
-- otro lado).
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS cartera.baterias_crm_pendientes (
  id SERIAL PRIMARY KEY,
  inversionista_id INTEGER NOT NULL,
  payload JSONB NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  ultimo_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS baterias_crm_pendientes_por_enviar_idx
  ON cartera.baterias_crm_pendientes (created_at)
  WHERE enviado_at IS NULL;
