CREATE TABLE IF NOT EXISTS "public"."buro_interno_personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid REFERENCES "public"."leads"("id") ON DELETE SET NULL,
	"numero_credito_sifco" text,
	"nombres" text NOT NULL,
	"apellidos" text NOT NULL,
	"dpi" text,
	"nit" text,
	"telefono" text,
	"direccion" text,
	"categoria" text NOT NULL,
	"motivo" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_por" text NOT NULL REFERENCES "public"."user"("id"),
	"desactivado_por" text REFERENCES "public"."user"("id"),
	"desactivado_at" timestamp with time zone,
	"motivo_desactivacion" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buro_interno_personas_dpi_activo_uq" ON "public"."buro_interno_personas" USING btree ("dpi") WHERE "activo" AND "dpi" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buro_interno_personas_lead_activo_uq" ON "public"."buro_interno_personas" USING btree ("lead_id") WHERE "activo" AND "lead_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buro_interno_personas_sifco_nombre_activo_uq" ON "public"."buro_interno_personas" USING btree ("numero_credito_sifco", regexp_replace(translate(lower("nombres" || "apellidos"), 'áéíóúüñ', 'aeiouun'), '\s', '', 'g')) WHERE "activo" AND "numero_credito_sifco" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buro_interno_personas_nit_activo_uq" ON "public"."buro_interno_personas" USING btree (upper(regexp_replace("nit", '[^0-9A-Za-z]', '', 'g'))) WHERE "activo" AND "nit" IS NOT NULL AND upper(regexp_replace("nit", '[^0-9A-Za-z]', '', 'g')) <> 'CF' AND length(regexp_replace("nit", '[^0-9A-Za-z]', '', 'g')) >= 3;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buro_interno_personas_activo_idx" ON "public"."buro_interno_personas" USING btree ("activo","created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."buro_interno_reglas" (
	"clave" text PRIMARY KEY NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"severidad" text NOT NULL,
	"parametros" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"updated_by" text REFERENCES "public"."user"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buro_interno_reglas_severidad_chk" CHECK ("severidad" IN ('alta', 'media', 'baja'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."buro_interno_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid REFERENCES "public"."buro_interno_personas"("id") ON DELETE SET NULL,
	"regla_clave" text,
	"accion" text NOT NULL,
	"detalle" jsonb,
	"realizado_por" text REFERENCES "public"."user"("id"),
	"realizado_por_rol" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buro_interno_eventos_persona_idx" ON "public"."buro_interno_eventos" USING btree ("persona_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buro_interno_eventos_created_at_idx" ON "public"."buro_interno_eventos" USING btree ("created_at");--> statement-breakpoint
-- Parámetros en '{}': toman los valores por defecto definidos en lib/buro-interno-match.ts hasta que alguien los edite
INSERT INTO "public"."buro_interno_reglas" ("clave", "activa", "severidad", "orden") VALUES
	('lead_igual', true, 'alta', 0),
	('dpi_igual', true, 'alta', 1),
	('nit_igual', true, 'alta', 2),
	('nombre_completo_igual', true, 'alta', 3),
	('telefono_igual', true, 'alta', 4),
	('nombre_similar', true, 'media', 5),
	('mismos_apellidos', true, 'media', 6),
	('apellido_y_direccion', true, 'media', 7),
	('apellido_en_comun', false, 'baja', 8)
ON CONFLICT ("clave") DO NOTHING;
