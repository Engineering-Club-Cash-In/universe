-- Que el aviso al cliente sobreviva a un proceso caído y a un desenlace que cambia.
--
-- Dos columnas para dos problemas distintos que compartían un solo campo
-- (`notificado_cliente_at`), y por compartirlo se pisaban:
--
--   1. `aviso_reclamado_en` — el derecho a mandar el WhatsApp se toma ANTES de
--      enviarlo, para que dos eventos hermanos simultáneos no manden dos
--      mensajes iguales. Si la marca fuera `notificado_cliente_at`, un proceso
--      que muere entre reclamar y enviar dejaría la boleta como notificada para
--      siempre sin que el cliente haya recibido nada. Esta marca vence: pasados
--      unos minutos, el job de respaldo la vuelve a tomar.
--
--   2. `desenlace_notificado` — qué se le dijo, no solo que se le dijo algo. Un
--      pago validado que contabilidad revierte después cambia el desenlace de la
--      boleta, y con un solo timestamp ese segundo mensaje nunca salía: la
--      boleta ya figuraba notificada. Comparar contra este campo distingue "ya
--      se lo dije" de "le dije otra cosa".
--
-- Aditiva y idempotente: sin datos que migrar, las boletas existentes se leen
-- igual que antes (ambas en NULL).
--
-- Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§6)

ALTER TABLE "bot_cobros_boletas"
  ADD COLUMN IF NOT EXISTS "desenlace_notificado" text,
  ADD COLUMN IF NOT EXISTS "aviso_reclamado_en"   timestamp with time zone;

-- El job de respaldo busca boletas que deben el mensaje: finales, con todos sus
-- pagos resueltos y sin haberle contado al cliente el desenlace que tienen.
CREATE INDEX IF NOT EXISTS "bot_cobros_boletas_aviso_debido_idx"
  ON "bot_cobros_boletas" ("estado", "notificado_cliente_at");
