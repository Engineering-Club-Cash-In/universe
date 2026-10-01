-- CB-039 — Investigación en redes sociales.
--
-- El asesor que busca al cliente (B2/B3) registra cada consulta que hace en
-- redes sociales: qué fuente miró, qué encontró, cuándo, y las capturas que lo
-- respaldan. Es una bitácora append-only: no se edita ni se borra; si algo
-- estaba mal, se registra otra entrada.
--
-- NO es una gestión con el cliente (no se le contactó), así que no escribe en
-- `contactos_cobros` ni agrega valores al enum `metodo_contacto`.
--
-- `resultado` va con CHECK: es la forma de la tabla. `fuente` en text validado
-- en TypeScript (lib/investigaciones-redes-cobros.ts): el catálogo de redes
-- cambia sin migración. Los buckets donde se permite registrar tampoco viven
-- acá: los define ese mismo archivo.
--
-- Las capturas van a R2 (privadas, se sirven con URL firmada), bajo
-- `cobros/investigaciones/<caso>/`.
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS "investigaciones_redes_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	-- Qué se consultó. `fuente_otra` solo cuando `fuente` = 'otra'.
	"fuente" text NOT NULL,
	"fuente_otra" text,
	"enlace_perfil" text,
	"resultado" text NOT NULL,
	-- Lo encontrado; si no hubo nada, qué se buscó.
	"hallazgos" text NOT NULL,
	-- Cuándo se hizo la investigación (puede ser anterior al registro).
	"fecha_investigacion" timestamp NOT NULL,
	-- Bucket del crédito al registrar (null si cartera no contestó).
	"bucket_snapshot" integer,
	"registrada_por" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "investigaciones_redes_cobros_resultado_check" CHECK ("resultado" IN ('con_hallazgos', 'sin_hallazgos'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "investigaciones_redes_cobros"
		ADD CONSTRAINT "investigaciones_redes_cobros_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "investigaciones_redes_cobros"
		ADD CONSTRAINT "investigaciones_redes_cobros_registrada_por_user_id_fk"
		FOREIGN KEY ("registrada_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investigaciones_redes_cobros_caso_fecha_idx"
	ON "investigaciones_redes_cobros" ("caso_cobro_id", "fecha_investigacion" DESC, "created_at" DESC);
--> statement-breakpoint
-- La evidencia: capturas o PDF en R2.
CREATE TABLE IF NOT EXISTS "investigaciones_redes_cobros_evidencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investigacion_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"nombre_archivo" text NOT NULL,
	"mime_type" text NOT NULL,
	"tamano_bytes" integer NOT NULL,
	"subido_por" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "investigaciones_redes_cobros_evidencias_r2_key_unique" UNIQUE ("r2_key")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "investigaciones_redes_cobros_evidencias"
		ADD CONSTRAINT "investigaciones_redes_cobros_evidencias_investigacion_id_fk"
		FOREIGN KEY ("investigacion_id") REFERENCES "public"."investigaciones_redes_cobros"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "investigaciones_redes_cobros_evidencias"
		ADD CONSTRAINT "investigaciones_redes_cobros_evidencias_subido_por_user_id_fk"
		FOREIGN KEY ("subido_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investigaciones_redes_cobros_evidencias_investigacion_idx"
	ON "investigaciones_redes_cobros_evidencias" ("investigacion_id");
