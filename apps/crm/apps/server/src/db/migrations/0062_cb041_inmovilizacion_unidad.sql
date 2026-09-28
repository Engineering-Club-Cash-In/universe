-- CB-041 — Solicitud de inmovilización (apagado) o reactivación de una
-- unidad, con aprobación del cobros_supervisor y llamada posterior al
-- cliente.
--
-- Modo manual a propósito: la integración con LEGION (unit/exec_cmd) está
-- bloqueada hasta confirmar permisos/comandos de su lado (CB-120).
-- modo_ejecucion default 'manual' — el supervisor coordina con LEGION por
-- fuera y marca acá cuando ya se ejecutó. CB-120 solo agrega el modo
-- 'proveedor', sin tocar esta migración.

DO $$ BEGIN
	CREATE TYPE "inmovilizacion_accion" AS ENUM ('apagado', 'reactivacion');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "inmovilizacion_estado" AS ENUM ('pendiente_aprobacion', 'aprobada', 'rechazada', 'ejecutada', 'cancelada');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "inmovilizacion_resultado" AS ENUM ('reactivada', 'enviada_recuperacion');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inmovilizaciones_unidad" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"numero_credito_sifco" text NOT NULL,
	"vehicle_id" uuid,
	"wialon_unit_id" integer,
	"accion" "inmovilizacion_accion" NOT NULL,
	"estado" "inmovilizacion_estado" DEFAULT 'pendiente_aprobacion' NOT NULL,
	"motivo" text NOT NULL,
	"bucket_snapshot" integer,
	"solicitado_por" text NOT NULL,
	"solicitado_at" timestamp DEFAULT now() NOT NULL,
	"decidido_por" text,
	"decidido_at" timestamp,
	"motivo_rechazo" text,
	"ejecutado_por" text,
	"ejecutado_at" timestamp,
	"modo_ejecucion" text DEFAULT 'manual' NOT NULL,
	"referencia_ejecucion" text,
	"inmovilizacion_origen_id" uuid,
	"llamada_contacto_id" uuid,
	"resultado" "inmovilizacion_resultado",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_vehicle_id_vehicles_id_fk"
		FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_solicitado_por_user_id_fk"
		FOREIGN KEY ("solicitado_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_decidido_por_user_id_fk"
		FOREIGN KEY ("decidido_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_ejecutado_por_user_id_fk"
		FOREIGN KEY ("ejecutado_por") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_llamada_contacto_id_contactos_cobros_id_fk"
		FOREIGN KEY ("llamada_contacto_id") REFERENCES "public"."contactos_cobros"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- La reactivación apunta al apagado que la originó. SET NULL: es solo
-- trazabilidad, no debe bloquear borrar la fila vieja.
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad"
		ADD CONSTRAINT "inmovilizaciones_unidad_inmovilizacion_origen_id_fk"
		FOREIGN KEY ("inmovilizacion_origen_id") REFERENCES "public"."inmovilizaciones_unidad"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inmovilizaciones_unidad_caso_abierta" ON "inmovilizaciones_unidad" ("caso_cobro_id") WHERE "estado" IN ('pendiente_aprobacion', 'aprobada');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_estado" ON "inmovilizaciones_unidad" ("estado");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_caso" ON "inmovilizaciones_unidad" ("caso_cobro_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inmovilizaciones_unidad_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inmovilizacion_id" uuid NOT NULL,
	"evento" text NOT NULL,
	"estado_anterior" "inmovilizacion_estado",
	"estado_nuevo" "inmovilizacion_estado" NOT NULL,
	"usuario_id" text NOT NULL,
	"detalle" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad_eventos"
		ADD CONSTRAINT "inmovilizaciones_unidad_eventos_inmovilizacion_id_fk"
		FOREIGN KEY ("inmovilizacion_id") REFERENCES "public"."inmovilizaciones_unidad"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "inmovilizaciones_unidad_eventos"
		ADD CONSTRAINT "inmovilizaciones_unidad_eventos_usuario_id_user_id_fk"
		FOREIGN KEY ("usuario_id") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inmovilizaciones_unidad_eventos_inmovilizacion" ON "inmovilizaciones_unidad_eventos" ("inmovilizacion_id");
--> statement-breakpoint
-- contactos_cobros: marca la gestión que registra la llamada posterior a un
-- apagado o reactivación ejecutados. Sin FK — ver comentario en el schema
-- (cobros.ts).
ALTER TABLE "contactos_cobros" ADD COLUMN IF NOT EXISTS "inmovilizacion_id" uuid;
--> statement-breakpoint
-- notifications: identifica la solicitud concreta para cerrar solo sus
-- avisos al decidir/ejecutar/llamar. SET NULL: borrar la inmovilización no
-- debe romper el aviso histórico.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "inmovilizacion_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "notifications"
		ADD CONSTRAINT "notifications_inmovilizacion_id_fk"
		FOREIGN KEY ("inmovilizacion_id") REFERENCES "public"."inmovilizaciones_unidad"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_inmovilizacion_pendiente" ON "notifications" ("inmovilizacion_id") WHERE "inmovilizacion_id" IS NOT NULL;
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'inmovilizacion_pendiente_aprobacion';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'inmovilizacion_resuelta';
--> statement-breakpoint
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'inmovilizacion_llamar_cliente';
