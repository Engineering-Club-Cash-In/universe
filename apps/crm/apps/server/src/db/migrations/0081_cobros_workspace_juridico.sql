-- COBROS-02 · Workspace de cobros, backend (issue #1873, W3 · escalar a Jurídico),
-- docs/features/cobros-02/22-plan-backend-workspace.md.
--
-- Una tabla (la solicitud, con su bitácora) y dos tipos de notificación para el
-- aviso al supervisor y la decisión de vuelta al asesor. La parte de cartera
-- (estado EN_JURIDICO, piso de B5) va en cartera-back/drizzle/cobros-02/0024.
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS "public"."solicitudes_juridico_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"numero_credito_sifco" text NOT NULL,
	"bucket_snapshot" integer NOT NULL,
	"motivo" text NOT NULL,
	"nota_juridico" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"solicitado_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"solicitado_en" timestamp DEFAULT now() NOT NULL,
	"resuelto_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"resuelto_en" timestamp,
	"nota_resolucion" text,
	CONSTRAINT "solicitudes_juridico_motivo_check" CHECK ("motivo" IN ('no_contacto', 'no_quiere_pagar', 'sin_acuerdo')),
	CONSTRAINT "solicitudes_juridico_estado_check" CHECK ("estado" IN ('pendiente', 'aprobada', 'aplicada', 'error_aplicacion', 'rechazada', 'cancelada'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_solicitud_juridico_abierta"
	ON "public"."solicitudes_juridico_cobros" ("caso_cobro_id")
	WHERE "estado" IN ('pendiente', 'aprobada', 'error_aplicacion');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_solicitudes_juridico_estado"
	ON "public"."solicitudes_juridico_cobros" ("estado", "solicitado_en" DESC);
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'juridico_pendiente_aprobacion';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'juridico_resuelto';
