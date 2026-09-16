-- COBROS-02 · Fase 1 — aviso de CONVENIO INCUMPLIDO.
--
-- Hasta hoy el incumplimiento de un convenio no le avisaba a nadie: los
-- recordatorios D-5/D-3/D-1/D-0 van al CLIENTE por WhatsApp y `cobros_notif_tipo`
-- no tenía ningún tipo de convenio vencido. El asesor se enteraba solo si abría
-- la ficha.
--
-- `ADD VALUE` es aditivo: no bloquea ni reescribe la tabla (mismo criterio que
-- 0053). Los valores nuevos no se pueden usar en la MISMA transacción que los
-- crea, así que este archivo se aplica con autocommit (flujo normal de psql).
ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'convenio_incumplido';--> statement-breakpoint

-- Llave de deduplicación GENÉRICA de las alertas de cobros.
--
-- Los jobs viejos deduplican por ventana de tiempo (`created_at > now() - 24h`),
-- que sirve cuando el episodio dura un día. No sirve acá: un convenio incumplido
-- sigue incumplido mañana, así que la ventana produciría un aviso diario al
-- asesor Y a cada supervisor. Lo que hace falta es una llave del EPISODIO —
-- "este convenio, esta cuota vencida"— y que la unicidad la sostenga la base, no
-- un SELECT previo (que no protege bajo concurrencia).
--
-- Es text y no una columna por caso de uso a propósito: la Fase 1.b la reusa
-- para el aviso del bot con la referencia de conversación (`sesion_id`). El
-- formato lo define cada job y queda documentado junto a él.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "cobros_dedup_key" text;--> statement-breakpoint

-- Una fila por (tipo, episodio, destinatario): la misma alerta va al asesor y a
-- cada supervisor, así que `assigned_to` es parte de la llave. Parcial: solo
-- aplica a las alertas que traen llave, el resto de notificaciones no se toca.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_cobros_dedup"
  ON "notifications" USING btree ("cobros_tipo", "cobros_dedup_key", "assigned_to")
  WHERE "notifications"."cobros_dedup_key" IS NOT NULL;
