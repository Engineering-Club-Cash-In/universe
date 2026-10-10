-- COBROS-02 · Workspace de cobros, backend (issue #1873,
-- docs/features/cobros-02/22-plan-backend-workspace.md).
--
-- W2 · Solicitud de rebaja de mora con aprobación del supervisor. Una tabla
-- (la bitácora de la solicitud) y dos tipos de notificación nuevos para los
-- avisos al supervisor y la decisión de vuelta al asesor.
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS "public"."solicitudes_rebaja_mora_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"numero_credito_sifco" text NOT NULL,
	"mora_snapshot" numeric(12, 2) NOT NULL,
	"monto_solicitado" numeric(12, 2) NOT NULL,
	"notas" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"solicitado_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"solicitado_en" timestamp DEFAULT now() NOT NULL,
	"resuelto_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"resuelto_en" timestamp,
	"nota_resolucion" text,
	"monto_aplicado" numeric(12, 2),
	"cartera_condonacion_id" integer,
	CONSTRAINT "solicitudes_rebaja_estado_check" CHECK ("estado" IN ('pendiente', 'aprobada', 'aplicada', 'error_aplicacion', 'rechazada', 'cancelada')),
	CONSTRAINT "solicitudes_rebaja_monto_check" CHECK ("monto_solicitado" > 0 AND "monto_solicitado" <= "mora_snapshot")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_solicitud_rebaja_abierta"
	ON "public"."solicitudes_rebaja_mora_cobros" ("caso_cobro_id")
	WHERE "estado" IN ('pendiente', 'aprobada', 'error_aplicacion');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_solicitudes_rebaja_estado"
	ON "public"."solicitudes_rebaja_mora_cobros" ("estado", "solicitado_en" DESC);
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'rebaja_pendiente_aprobacion';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'rebaja_resuelta';
