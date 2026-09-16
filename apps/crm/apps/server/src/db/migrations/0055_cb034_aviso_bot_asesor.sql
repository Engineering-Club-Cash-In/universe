-- COBROS-02 · Fase 1.b — aviso al asesor cuando un cliente suyo escribe en el bot.
--
-- El bot atiende al cliente y deja su historial en la Ficha 360, pero no avisa
-- a nadie: hoy el asesor se entera solo si abre la ficha. El aviso se agrupa por
-- REFERENCIA DE CONVERSACIÓN (`sesion_id`), reusando la columna
-- `cobros_dedup_key` y su índice único de la migración 0054 — no hace falta
-- nada más que el valor del enum.
ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'bot_cliente_escribio';
