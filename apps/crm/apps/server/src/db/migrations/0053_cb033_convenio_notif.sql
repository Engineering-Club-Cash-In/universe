-- CB-033. No ejecutar desde agente: aplicar con flujo normal de migraciones.
--
-- Notificaciones de la aprobación de convenios: dos valores nuevos en
-- cobros_notif_tipo (ADD VALUE es aditivo, no bloquea ni reescribe tabla —
-- ver el comentario en db/schema/cobros.ts sobre pgEnum) y la columna que
-- hace posible la dedup por decisión, con su índice único parcial.
ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'convenio_pendiente_aprobacion';--> statement-breakpoint
ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'convenio_resuelto';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "convenio_decision_id" integer;--> statement-breakpoint
-- La dedup es esta restricción, no una consulta previa a un INSERT: un
-- SELECT antes del INSERT no protege bajo concurrencia. La clave incluye
-- assigned_to porque una misma decisión notifica a varios supervisores —
-- una fila por (decisión, destinatario), nunca dos. Parcial: solo aplica
-- cuando hay decisión.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notifications_convenio_decision" ON "notifications" USING btree ("convenio_decision_id","assigned_to") WHERE "notifications"."convenio_decision_id" IS NOT NULL;
