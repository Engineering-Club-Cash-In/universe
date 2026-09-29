-- CB-035: tarea de llamada al supervisor en los primeros 3 días de ingreso a B3.
-- Idempotente. Se aplica a mano (el _journal de drizzle no llega a esta migración).
--
-- notifications: vencimiento propio de la tarea. Null para el resto de avisos.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "fecha_vencimiento" timestamp;
--> statement-breakpoint
-- Tarea de llamada al supervisor al ingresar un crédito a B3.
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'b3_llamada_supervisor';
--> statement-breakpoint
-- Alerta a supervisores + asesor cuando la tarea vence sin llamada.
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'b3_llamada_vencida';
