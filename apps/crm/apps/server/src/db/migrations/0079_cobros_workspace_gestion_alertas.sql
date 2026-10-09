-- COBROS-02 · Workspace de cobros, backend (issue #1873,
-- docs/features/cobros-02/22-plan-backend-workspace.md).
--
-- W1 · Datos de la gestión que el Workspace ya envía y hoy se descartaban:
-- dirección (saliente/entrante), nombre de quien contestó y teléfono al que se
-- contactó. Las columnas de hora, medio y tipo de participante ya existen (0077).
-- NULL = gestiones anteriores.
--
-- W5 · Alertas del caso marcadas como leídas, por grupo (tipo de alerta,
-- destinatario y caso). Ver el comentario de la tabla en schema/cobros.ts.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE "public"."contactos_cobros"
	ADD COLUMN IF NOT EXISTS "direccion_contacto" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public"."contactos_cobros"
		ADD CONSTRAINT "contactos_cobros_direccion_contacto_check"
		CHECK ("direccion_contacto" IS NULL OR "direccion_contacto" IN ('saliente', 'entrante'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "public"."contactos_cobros"
	ADD COLUMN IF NOT EXISTS "participante_nombre" text;
--> statement-breakpoint
ALTER TABLE "public"."contactos_cobros"
	ADD COLUMN IF NOT EXISTS "telefono_contactado" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."alertas_caso_leidas_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE CASCADE,
	"clave" text NOT NULL,
	"leida_hasta" timestamp NOT NULL,
	"leida_en" timestamp DEFAULT now() NOT NULL,
	"leida_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"origen" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "uq_alertas_caso_leidas_grupo" UNIQUE ("caso_cobro_id", "user_id", "clave"),
	CONSTRAINT "alertas_caso_leidas_origen_check" CHECK ("origen" IN ('manual', 'automatico'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_alertas_caso_leidas_user"
	ON "public"."alertas_caso_leidas_cobros" ("user_id", "caso_cobro_id");
