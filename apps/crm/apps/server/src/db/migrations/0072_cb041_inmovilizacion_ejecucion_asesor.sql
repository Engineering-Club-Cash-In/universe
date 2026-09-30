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
--  * Al registrarse un apagado ejecutado, los cobros_supervisor reciben un
--    aviso (`inmovilizacion_apagado_ejecutado`). El tipo
--    `inmovilizacion_reactivacion_ejecutada` queda creado para la reactivación.
--
-- Todas las columnas son nullable: las filas anteriores (y las reactivaciones)
-- no las usan. `motivo` sigue siendo NOT NULL y guarda el texto compuesto.

ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "motivos" jsonb;
--> statement-breakpoint
ALTER TABLE "inmovilizaciones_unidad" ADD COLUMN IF NOT EXISTS "motivo_detalle" text;
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
