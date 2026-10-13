-- Recuerda el pago de un evento de Nexa cuando el pago se borra al marcar el crédito CAÍDO.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Va a la base ANTES que el código que la lee o escribe. Es aditiva: la columna
-- admite NULL, así que el código anterior sigue funcionando igual.
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- Marcar un crédito CAÍDO borra sus pagos, y antes desvincula los eventos de
-- Nexa que apuntan a ellos (pago_id = NULL; la FK no tiene ON DELETE). Sin el
-- pago_id, un reintento de Nexa de esa misma transferencia (mismo
-- external_reference, nonce nuevo) ya no se reconoce como aplicado: cae a
-- manual_review y nexa-server recibe 503 para siempre por una transferencia que
-- cartera ya aceptó. Esta columna guarda el pago que tenía el evento para que el
-- reintento se conteste como idempotente con ese mismo id.
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
-- • Sin FK: el pago ya no existe; es constancia, no referencia.
-- • Sin índice: solo se lee junto con el evento, que ya se busca por su clave.

ALTER TABLE cartera.nexa_payment_events
  ADD COLUMN IF NOT EXISTS pago_id_eliminado integer;
