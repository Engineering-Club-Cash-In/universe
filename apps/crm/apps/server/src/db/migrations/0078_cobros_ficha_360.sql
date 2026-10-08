-- COBROS-02 · Ficha 360 rediseñada, backend (issue #1864,
-- docs/features/cobros-02/21-plan-backend-ficha-360.md).
--
-- F8 · Direcciones corregidas desde la ficha. NULL = la de origen (residencia
-- del lead, trabajo de la solicitud de crédito firmada); esas fuentes no se
-- pisan.
--
-- F3 · Bitácora de cambios de los datos del cliente hechos desde cobros:
-- campo, antes y después, quién y desde dónde. Append-only.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE "public"."casos_cobros"
	ADD COLUMN IF NOT EXISTS "direccion_residencia_cobros" text;
ALTER TABLE "public"."casos_cobros"
	ADD COLUMN IF NOT EXISTS "empresa_trabajo_cobros" text;
ALTER TABLE "public"."casos_cobros"
	ADD COLUMN IF NOT EXISTS "direccion_trabajo_cobros" text;

CREATE TABLE IF NOT EXISTS "public"."cambios_datos_cliente_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"campo" text NOT NULL,
	"categoria" text NOT NULL,
	"valor_anterior" text,
	"valor_nuevo" text,
	"origen" text NOT NULL,
	"realizado_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cambios_datos_cliente_categoria_check"
		CHECK ("categoria" IN ('contacto', 'direcciones', 'datos_personales')),
	CONSTRAINT "cambios_datos_cliente_origen_check"
		CHECK ("origen" IN ('ficha_360', 'workspace', 'carga_masiva', 'sistema'))
);

CREATE INDEX IF NOT EXISTS "idx_cambios_datos_cliente_caso"
	ON "public"."cambios_datos_cliente_cobros" ("caso_cobro_id", "created_at" DESC);
