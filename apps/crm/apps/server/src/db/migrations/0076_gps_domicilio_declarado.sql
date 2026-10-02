-- CB-119 — Confirmar "probable casa" y "probable trabajo" contra la dirección
-- declarada.
--
-- El asesor busca en Google Maps la dirección que el cliente declaró en su
-- solicitud (residencia o trabajo) y pega las coordenadas en la ficha. Si
-- quedan a menos de (radio del cluster + margen) de la "probable casa" o el
-- "probable trabajo" del GPS, se marca como confirmado. Una fila por caso y
-- tipo. Tabla aparte de `gps_ubicaciones_clave` porque el job nocturno
-- REEMPLAZA esas filas en cada corrida; la coincidencia se calcula al leer.
--
-- Idempotente: se puede correr más de una vez.

DO $$ BEGIN
	CREATE TYPE "public"."gps_domicilio_tipo" AS ENUM ('casa', 'trabajo');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."gps_domicilio_declarado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"tipo" "public"."gps_domicilio_tipo" NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"direccion_texto" text,
	"registrado_por" text,
	"registrado_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gps_domicilio_declarado_caso_tipo_unique" UNIQUE ("caso_cobro_id", "tipo")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public"."gps_domicilio_declarado"
		ADD CONSTRAINT "gps_domicilio_declarado_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public"."gps_domicilio_declarado"
		ADD CONSTRAINT "gps_domicilio_declarado_registrado_por_user_id_fk"
		FOREIGN KEY ("registrado_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
