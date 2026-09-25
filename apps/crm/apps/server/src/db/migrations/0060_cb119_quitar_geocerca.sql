-- CB-119 — Se quita "salida_geocerca" (el vehículo salió del polígono de
-- Guatemala). El alcance real de la historia era otro (ubicaciones donde el
-- vehículo pasa más tiempo, no un cruce de frontera) — la 0059 original en
-- código ya no lo incluye, pero esta migración limpia las bases dev que ya
-- corrieron esa versión vieja antes del cambio de alcance.
--
-- Idempotente en los dos sentidos: si una base corrió la 0059 vieja (con
-- 'salida_geocerca' en el enum y 'dentro_de_geocerca' en gps_unidad_estado),
-- esto los quita. Si una base corrió directo la 0059 ya editada (sin
-- geocerca desde el principio), esto no encuentra nada que tocar y no falla.

DO $$ BEGIN
	-- Solo purga eventos de un tipo que puede no existir en el enum —
	-- separado del bloque de abajo para no depender de que el DELETE se
	-- ejecute antes de saber si hay que tocar el enum.
	IF EXISTS (
		SELECT 1 FROM pg_type t
		JOIN pg_enum e ON e.enumtypid = t.oid
		WHERE t.typname = 'gps_evento_tipo' AND e.enumlabel = 'salida_geocerca'
	) THEN
		DELETE FROM "gps_eventos" WHERE "tipo" = 'salida_geocerca';
	END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_type t
		JOIN pg_enum e ON e.enumtypid = t.oid
		WHERE t.typname = 'gps_evento_tipo' AND e.enumlabel = 'salida_geocerca'
	) THEN
		ALTER TYPE "gps_evento_tipo" RENAME TO "gps_evento_tipo_old";
		CREATE TYPE "gps_evento_tipo" AS ENUM ('desconexion_energia', 'ignicion', 'sin_reportar');
		ALTER TABLE "gps_eventos"
			ALTER COLUMN "tipo" TYPE "gps_evento_tipo"
			USING "tipo"::text::"gps_evento_tipo";
		DROP TYPE "gps_evento_tipo_old";
	END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "gps_unidad_estado" DROP COLUMN IF EXISTS "dentro_de_geocerca";
