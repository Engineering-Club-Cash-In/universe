-- CB-119 (D-15) — Ubicaciones donde un vehículo en B4 pasa más tiempo (casa,
-- trabajo, lugares recurrentes), calculadas por un job nocturno contra el
-- historial de posiciones de Wialon (messages/load_interval, que el CRM no
-- guarda — la fuente de verdad del historial crudo es Wialon). Reemplaza el
-- enfoque de "salida de geocerca" (D-14), retirado en la 0060: el alcance
-- real del ticket era identificar dónde suele estar el vehículo, no detectar
-- un cruce de frontera.
--
-- gps_ubicaciones_clave es un SNAPSHOT, no historial: cada corrida del job
-- reemplaza las filas de un (unidad, SIFCO) en una transacción, sobre la
-- ventana de los últimos 60 días. No se acumulan corridas viejas.

DO $$ BEGIN
	CREATE TYPE "gps_ubicacion_clave_tipo" AS ENUM ('probable_casa', 'probable_trabajo', 'recurrente', 'frecuente');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gps_ubicaciones_clave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wialon_unit_id" integer NOT NULL,
	"numero_credito_sifco" text NOT NULL,
	"vehicle_id" uuid,
	"caso_cobro_id" uuid,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"radio_m" double precision NOT NULL,
	"tipo" "gps_ubicacion_clave_tipo" NOT NULL,
	"horas_totales" double precision NOT NULL,
	"dias_distintos" integer NOT NULL,
	"visitas" integer NOT NULL,
	"patron" jsonb NOT NULL,
	"primera_visita" timestamp NOT NULL,
	"ultima_visita" timestamp NOT NULL,
	"ventana_desde" timestamp NOT NULL,
	"ventana_hasta" timestamp NOT NULL,
	"calculado_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_ubicaciones_clave"
		ADD CONSTRAINT "gps_ubicaciones_clave_vehicle_id_vehicles_id_fk"
		FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_ubicaciones_clave"
		ADD CONSTRAINT "gps_ubicaciones_clave_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_ubicaciones_clave_unidad_sifco" ON "gps_ubicaciones_clave" ("wialon_unit_id", "numero_credito_sifco");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_ubicaciones_clave_caso" ON "gps_ubicaciones_clave" ("caso_cobro_id");
