-- CB-036 — Gestión de referencias desde la Ficha 360: cuando no se localiza
-- al cliente, el asesor llama a sus referencias (las que cargó cobros, las de
-- la solicitud de crédito de ventas, cónyuge, emergencia y cofirmantes),
-- deja registro de cada gestión y anota la información nueva que consiga.
--
-- Las referencias NO se copian: se leen al vuelo de referencias_lead,
-- credit_applications y co_debtors, identificadas por una referencia_key
-- estable (lib/referencias-cobros.ts). Estas tablas guardan solo lo que cobros
-- agrega encima.
--
-- Catálogos (origen, resultado, tipo) en text validado en TypeScript, no en
-- enum nativo: son provisionales y un enum no se puede recortar en caliente.
--
-- Idempotente: se puede correr más de una vez.

-- 1) Teléfonos que cobros le agrega a una referencia (de cualquier origen),
--    sin tocar lo que capturó ventas.
CREATE TABLE IF NOT EXISTS "referencias_telefonos_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"referencia_key" text NOT NULL,
	"telefono" text NOT NULL,
	"notas" text,
	"registrado_por" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "referencias_telefonos_cobros"
		ADD CONSTRAINT "referencias_telefonos_cobros_lead_id_leads_id_fk"
		FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "referencias_telefonos_cobros"
		ADD CONSTRAINT "referencias_telefonos_cobros_registrado_por_user_id_fk"
		FOREIGN KEY ("registrado_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_referencias_telefonos_cobros"
	ON "referencias_telefonos_cobros" ("lead_id", "referencia_key", "telefono");
--> statement-breakpoint

-- 2) Bitácora de gestiones a referencias. Append-only (sin updated_at).
--    Aparte de contactos_cobros a propósito: hablar con una referencia NO
--    cuenta como contactar al cliente para SLA / cola / alertas / B1
--    (decisión de negocio del 2026-09-25, puede cambiar — ver el comentario
--    del schema y docs/features/cobros-02/06-ficha-360.md).
CREATE TABLE IF NOT EXISTS "contactos_referencias_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"referencia_key" text NOT NULL,
	"referencia_origen" text NOT NULL,
	"referencia_nombre" text NOT NULL,
	"telefono" text,
	"metodo_contacto" "metodo_contacto" NOT NULL,
	"resultado" text NOT NULL,
	"comentarios" text,
	"realizado_por" text NOT NULL,
	"fecha_contacto" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contactos_referencias_cobros"
		ADD CONSTRAINT "contactos_referencias_cobros_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "contactos_referencias_cobros"
		ADD CONSTRAINT "contactos_referencias_cobros_realizado_por_user_id_fk"
		FOREIGN KEY ("realizado_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contactos_referencias_cobros_caso_fecha"
	ON "contactos_referencias_cobros" ("caso_cobro_id", "fecha_contacto" DESC);
--> statement-breakpoint

-- 3) Información nueva del cliente (teléfono, dirección, ubicación), con su
--    procedencia. No se aplica sola al caso: el asesor decide.
CREATE TABLE IF NOT EXISTS "hallazgos_localizacion_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"contacto_referencia_id" uuid,
	"tipo" text NOT NULL,
	"valor" text NOT NULL,
	"enlace_mapa" text,
	"notas" text,
	"registrado_por" text NOT NULL,
	"agregado_al_caso_at" timestamp,
	"agregado_al_caso_por" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "hallazgos_localizacion_cobros"
		ADD CONSTRAINT "hallazgos_localizacion_cobros_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "hallazgos_localizacion_cobros"
		ADD CONSTRAINT "hallazgos_localizacion_cobros_contacto_referencia_id_fk"
		FOREIGN KEY ("contacto_referencia_id") REFERENCES "public"."contactos_referencias_cobros"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "hallazgos_localizacion_cobros"
		ADD CONSTRAINT "hallazgos_localizacion_cobros_registrado_por_user_id_fk"
		FOREIGN KEY ("registrado_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "hallazgos_localizacion_cobros"
		ADD CONSTRAINT "hallazgos_localizacion_cobros_agregado_al_caso_por_user_id_fk"
		FOREIGN KEY ("agregado_al_caso_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hallazgos_localizacion_cobros_caso"
	ON "hallazgos_localizacion_cobros" ("caso_cobro_id", "created_at" DESC);
