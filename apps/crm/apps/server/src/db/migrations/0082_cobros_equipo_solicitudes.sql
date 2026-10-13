-- COBROS-02 · Mi equipo y Solicitudes del supervisor, backend (issue #1895,
-- tareas M1 a M7), docs/features/cobros-02/24-plan-backend-equipo-solicitudes.md.
--
-- Una sola migración para toda la feature (M3, M4 y M5). Idempotente: se puede
-- correr más de una vez. Solo se corre en la BD local o en DEV, nunca en PROD
-- (COBROS-02 no va a PROD hasta el pase masivo).

-- ── M3 · nota del supervisor al aprobar un apagado o una reactivación ──────────
ALTER TABLE "public"."inmovilizaciones_unidad"
	ADD COLUMN IF NOT EXISTS "nota_decision" text;
--> statement-breakpoint
-- Los historiales filtran y ordenan por fecha de solicitud y de decisión.
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_solicitado_at"
	ON "public"."inmovilizaciones_unidad" ("solicitado_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_decidido_at"
	ON "public"."inmovilizaciones_unidad" ("decidido_at" DESC)
	WHERE "decidido_at" IS NOT NULL;
--> statement-breakpoint

-- ── M4 · contrapropuesta de convenio ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public"."contrapropuestas_convenio_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"convenio_id" integer NOT NULL,
	"numero_credito_sifco" text NOT NULL,
	"monto_total" numeric(14, 2) NOT NULL,
	"numero_meses_original" integer NOT NULL,
	"cuota_mensual_original" numeric(14, 2) NOT NULL,
	"primer_pago_original" date,
	"numero_meses" integer NOT NULL,
	"cuota_mensual" numeric(14, 2) NOT NULL,
	"primer_pago" date NOT NULL,
	"nota" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creada_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"creada_en" timestamp DEFAULT now() NOT NULL,
	"resuelta_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"resuelta_en" timestamp,
	"nota_respuesta" text,
	CONSTRAINT "contrapropuestas_convenio_estado_check" CHECK ("estado" IN ('pendiente', 'aceptada', 'descartada', 'sin_efecto')),
	CONSTRAINT "contrapropuestas_convenio_meses_check" CHECK ("numero_meses" BETWEEN 1 AND 60)
);
--> statement-breakpoint
-- Una sola contrapropuesta abierta por convenio.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_contrapropuesta_convenio_pendiente"
	ON "public"."contrapropuestas_convenio_cobros" ("convenio_id")
	WHERE "estado" = 'pendiente';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contrapropuestas_convenio"
	ON "public"."contrapropuestas_convenio_cobros" ("convenio_id", "creada_en" DESC);
--> statement-breakpoint
ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'convenio_contrapropuesta';
--> statement-breakpoint
ALTER TYPE "public"."cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'convenio_contrapropuesta_respondida';
