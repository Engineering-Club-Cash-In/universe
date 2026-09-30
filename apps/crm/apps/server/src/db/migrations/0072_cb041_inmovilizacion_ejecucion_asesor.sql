-- CB-041 — El apagado lo ejecuta el asesor, con ubicación GPS y evidencia.
--
-- Antes: el asesor pedía el apagado con un motivo de texto, el supervisor lo
-- aprobaba y lo marcaba ejecutado en la cola. Ahora:
--  * Al solicitar se piden los motivos (catálogo, como la recuperación forzosa)
--    y la ubicación del vehículo (Wialon o manual).
--  * Tras la aprobación, el asesor declara en la Ficha 360 que LEGION ya
--    apagó la unidad, con un archivo y/o una nota, y se vuelve a consultar la
--    ubicación. Quién lo hizo queda en `ejecutado_por` / `ejecutado_at`.
--  * Si pasan 24 h aprobado y sin ejecutar, el asesor recibe un recordatorio
--    (`inmovilizacion_ejecutar_pendiente`).
--  * Al registrarse un apagado o una reactivación ejecutados, los
--    cobros_supervisor reciben un aviso (`inmovilizacion_apagado_ejecutado` /
--    `inmovilizacion_reactivacion_ejecutada`).
--  * La reactivación se pide con una opción ("Pago", "Promesa de pago", "50% +
--    promesa") y el pago o la promesa que la respaldan (`que_paso`,
--    `respaldo_reactivacion`), y la ejecuta también el asesor.
--
-- Todas las columnas son nullable: las filas anteriores (y las reactivaciones)
-- no las usan. `motivo` sigue siendo NOT NULL y guarda el texto compuesto.

ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "motivos" jsonb;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "motivo_detalle" text;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "que_paso" text;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "respaldo_reactivacion" jsonb;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "ubicacion_solicitud" jsonb;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "ubicacion_ejecucion" jsonb;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "evidencia_r2_key" text;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "evidencia_nombre_archivo" text;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "evidencia_mime" text;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "evidencia_nota" text;
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'inmovilizacion_ejecutar_pendiente';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'inmovilizacion_apagado_ejecutado';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'inmovilizacion_reactivacion_ejecutada';
--> statement-breakpoint
-- Reactivaciones ABIERTAS sin respaldo: las creó la llamada posterior al apagado
-- ("Pagó") o se pidieron con un texto libre, antes de exigir `que_paso` y
-- `respaldo_reactivacion`. No se pueden aprobar ni ejecutar sin el pago o la
-- promesa (la aprobación y la ejecución las rechazan) y, abiertas, bloquean
-- pedir una nueva por el índice único por caso/unidad: se cancelan y el asesor
-- la pide de nuevo con respaldo. Las ya ejecutadas no se tocan. Idempotente.
INSERT INTO "inmovilizaciones_unidad_eventos" ("inmovilizacion_id", "evento", "estado_anterior", "estado_nuevo", "usuario_id", "detalle")
SELECT "id", 'cancelar', "estado", 'cancelada', "solicitado_por",
	'{"motivo": "Reactivación pedida sin respaldo de pago o promesa"}'::jsonb
FROM "inmovilizaciones_unidad"
WHERE "accion" = 'reactivacion'
	AND "estado" IN ('pendiente_aprobacion', 'aprobada')
	AND "que_paso" IS NULL;
--> statement-breakpoint
UPDATE "notifications"
SET "status" = 'resolved', "resolved_at" = now(), "updated_at" = now()
WHERE "inmovilizacion_id" IN (
		SELECT "id" FROM "inmovilizaciones_unidad"
		WHERE "accion" = 'reactivacion'
			AND "estado" IN ('pendiente_aprobacion', 'aprobada')
			AND "que_paso" IS NULL
	)
	AND "cobros_tipo" IN ('inmovilizacion_pendiente_aprobacion', 'inmovilizacion_resuelta')
	AND "status" IN ('pending', 'read', 'in_progress');
--> statement-breakpoint
UPDATE "inmovilizaciones_unidad"
SET "estado" = 'cancelada', "updated_at" = now()
WHERE "accion" = 'reactivacion'
	AND "estado" IN ('pendiente_aprobacion', 'aprobada')
	AND "que_paso" IS NULL;
