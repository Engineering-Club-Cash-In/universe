-- CB-043 — La recuperación forzosa pasa por el supervisor.
--
-- El PM unificó CB-043 ("B4 anticipado por gestión agotada, con checklist y
-- aprobación") con la recuperación forzosa de CB-042: el asesor ya no manda el
-- crédito a B4 con un clic, lo SOLICITA con un checklist de lo que se hizo, y
-- un cobros_supervisor (o admin) lo aprueba —recién ahí se traslada— o lo
-- rechaza con motivo. La entrega voluntaria sigue directa.
--
-- La solicitud vive en la misma fila de `recuperaciones_vehiculo` que después
-- ve el asesor de B4: así el porqué y el checklist llegan con el crédito.
--
--   · estado_solicitud = NULL        → el registro no pasó por aprobación
--     (entrega voluntaria, o forzosa anterior a CB-043). Todos los viejos
--     quedan así: eran envíos reales.
--   · 'pendiente'                    → esperando al supervisor; el crédito
--     sigue en su bucket.
--   · 'aprobada'                     → se trasladó (o la pidió un supervisor).
--   · 'rechazada' / 'cancelada'      → no pasó nada en cartera.
--   · 'sin_efecto'                   → el crédito salió del rango (pagó, llegó
--     solo a B4, entró en convenio) antes de que alguien decidiera.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE "recuperaciones_vehiculo"
	ADD COLUMN IF NOT EXISTS "estado_solicitud" text,
	-- Lo que se hizo antes de pedir: un paso por elemento, con la evidencia que
	-- el CRM encontró y la justificación de lo que no se hizo
	-- (lib/recuperacion-solicitud.ts). NULL en los registros sin checklist.
	ADD COLUMN IF NOT EXISTS "checklist" jsonb,
	ADD COLUMN IF NOT EXISTS "decidido_por" text,
	ADD COLUMN IF NOT EXISTS "decidido_at" timestamp,
	-- Por qué se rechazó, se canceló o quedó sin efecto.
	ADD COLUMN IF NOT EXISTS "motivo_decision" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recuperaciones_vehiculo"
		ADD CONSTRAINT "recuperaciones_vehiculo_estado_solicitud_check"
		CHECK ("estado_solicitud" IS NULL OR "estado_solicitud" IN ('pendiente', 'aprobada', 'rechazada', 'cancelada', 'sin_efecto'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recuperaciones_vehiculo"
		ADD CONSTRAINT "recuperaciones_vehiculo_decidido_por_user_id_fk"
		FOREIGN KEY ("decidido_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Una sola solicitud pendiente por caso: es la protección real bajo doble clic
-- o dos asesores a la vez (mismo criterio que uq_inmovilizaciones_unidad_caso_abierta).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_recuperaciones_vehiculo_caso_pendiente"
	ON "recuperaciones_vehiculo" ("caso_cobro_id")
	WHERE "estado_solicitud" = 'pendiente';
--> statement-breakpoint
-- La bandeja del supervisor: las pendientes, las más viejas primero.
CREATE INDEX IF NOT EXISTS "recuperaciones_vehiculo_estado_solicitud_idx"
	ON "recuperaciones_vehiculo" ("estado_solicitud", "created_at")
	WHERE "estado_solicitud" IS NOT NULL;
--> statement-breakpoint
-- La solicitud nueva va a los cobros_supervisor; la decisión, de vuelta a
-- quien la pidió. Dedup por solicitud y destinatario (uq_notifications_cobros_dedup).
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'recuperacion_pendiente_aprobacion';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'recuperacion_resuelta';
