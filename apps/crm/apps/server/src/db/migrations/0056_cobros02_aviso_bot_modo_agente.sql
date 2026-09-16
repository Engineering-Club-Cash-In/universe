-- COBROS-02 — aviso al asesor cuando su cliente pasa a MODO AGENTE en el bot.
--
-- Hoy el asesor recibe `bot_cliente_escribio` cuando un cliente suyo empieza a
-- usar el bot (migración 0055). Faltaba el segundo momento, el que de verdad
-- pide acción: el cliente pidió hablar con una persona y está esperando en
-- WhatsApp. Lo informa SimpleTech con `POST /api/bot/cobros/conversacion/modo-agente`.
--
-- Las dos alertas son la misma conversación: la segunda apunta a la primera por
-- `notificacion_origen_id`, para que el asesor las vea como un hilo y no como
-- dos avisos sueltos. La dedup reusa `cobros_dedup_key` y el índice único de la
-- 0054 (el tipo es parte de la llave, así que la misma llave de conversación
-- sirve para los dos tipos sin chocar).
--
-- OJO: `ALTER TYPE ... ADD VALUE` no puede usarse dentro de la misma
-- transacción en la que se agrega. Correr este archivo sentencia por sentencia
-- (los breakpoints) o fuera de un BEGIN/COMMIT.

ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'bot_modo_agente';
--> statement-breakpoint

ALTER TABLE "public"."notifications"
  ADD COLUMN IF NOT EXISTS "notificacion_origen_id" uuid
  REFERENCES "public"."notifications" ("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_notifications_origen"
  ON "public"."notifications" ("notificacion_origen_id")
  WHERE "notificacion_origen_id" IS NOT NULL;
