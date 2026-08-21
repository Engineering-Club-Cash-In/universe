-- El reclamo del aviso al cliente (paso 4, capa C — D-39).
--
-- El derecho a mandar el WhatsApp del rechazo se toma ANTES de enviarlo, para
-- que dos llamadas simultáneas no manden dos mensajes iguales. La marca del
-- reclamo NO puede ser `notificado_cliente_at` —que significa "esto se le
-- entregó"—: un proceso que muere entre reclamar y enviar no ejecuta ningún
-- catch, y esa boleta quedaría "notificada" para siempre sin que el cliente
-- hubiera recibido nada. Esta marca VENCE (10 min) y el job de respaldo la
-- vuelve a tomar.
--
-- Aditiva e idempotente. Sin backfill: la columna nueva arranca en NULL y eso
-- es exactamente lo que significa "nadie lo está mandando".
--
-- Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)

ALTER TABLE "bot_cobros_boletas"
  ADD COLUMN IF NOT EXISTS "aviso_reclamado_en" timestamp with time zone;

-- El job de respaldo busca boletas rechazadas a las que se les debe el mensaje.
CREATE INDEX IF NOT EXISTS "bot_cobros_boletas_aviso_debido_idx"
  ON "bot_cobros_boletas" ("estado", "notificado_cliente_at");
