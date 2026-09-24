-- CB-119 — Alertas GPS por eventos de Wialon (desconexión de energía,
-- ignición, GPS sin reportar, salida de geocerca) para vehículos con caso de
-- cobro activo en B4, detectados por un job de polling (sin depender de que
-- Wialon configure webhooks del lado de La Legión).
--
-- gps_integracion_logs (0058, CB-121) audita CADA LLAMADA HTTP del CRM hacia
-- Wialon. Esto es otra cosa: gps_eventos audita EVENTOS de negocio que el
-- job detecta comparando el estado actual de una unidad contra el último
-- que vio — una fila por evento, no por intento HTTP. Vive 180 días
-- (retención mayor que los 90 de gps_integracion_logs porque además
-- alimenta el historial de la Ficha 360).
--
-- gps_unidad_estado NO es historial: una fila por unidad, sobreescrita en
-- cada corrida del job. Es el "último estado crudo visto", necesario para
-- saber si una transición YA ocurrió (y ya se notificó) o si recién pasa
-- ahora — sin esto, cada corrida del job volvería a ver "ignición encendida"
-- y generaría una alerta nueva cada 5 minutos mientras el motor siga prendido.

DO $$ BEGIN
	CREATE TYPE "gps_evento_tipo" AS ENUM ('desconexion_energia', 'ignicion', 'sin_reportar', 'salida_geocerca');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gps_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "gps_evento_tipo" NOT NULL,
	"wialon_unit_id" integer NOT NULL,
	"vehicle_id" uuid,
	"caso_cobro_id" uuid,
	"ocurrido_at" timestamp NOT NULL,
	"recibido_at" timestamp DEFAULT now() NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"velocidad_kmh" double precision,
	"payload" jsonb,
	"notificado" boolean DEFAULT false NOT NULL,
	"dedup_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_eventos"
		ADD CONSTRAINT "gps_eventos_vehicle_id_vehicles_id_fk"
		FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_eventos"
		ADD CONSTRAINT "gps_eventos_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE UNIQUE INDEX "uq_gps_eventos_dedup_key" ON "gps_eventos" ("dedup_key");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_eventos_caso_ocurrido" ON "gps_eventos" ("caso_cobro_id", "ocurrido_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_eventos_unidad_ocurrido" ON "gps_eventos" ("wialon_unit_id", "ocurrido_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_eventos_recibido_at" ON "gps_eventos" ("recibido_at");
--> statement-breakpoint

-- Snapshot del último estado visto por unidad (no historial: se sobreescribe
-- cada corrida). Solo cubre unidades con caso de cobro activo al momento de
-- la última corrida; una unidad que sale de cobros deja de actualizarse pero
-- su fila no se borra (referencia útil, sin costo de mantenerla).
CREATE TABLE IF NOT EXISTS "gps_unidad_estado" (
	"wialon_unit_id" integer PRIMARY KEY,
	"pwr_ext" double precision,
	"ignicion_on" boolean,
	"ultima_señal_wialon" timestamp,
	"sin_reportar_desde" timestamp,
	"dentro_de_geocerca" boolean,
	"actualizado_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Nuevo subtipo de notificación de cobros para las alertas de eventos GPS
-- (dedup vía uq_notifications_cobros_dedup, migración 0054).
DO $$ BEGIN
	ALTER TYPE "cobros_notif_tipo" ADD VALUE 'gps_evento';
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
