-- CB-121 — Trazabilidad y manejo de fallas de la integración GPS/Wialon.
--
-- gps_consulta_logs (0057, CB-118) audita la INTENCIÓN de negocio: quién vio
-- la ubicación de un vehículo, por qué motivo y para qué crédito. Esto es
-- otra cosa: registra qué pasó con CADA llamada HTTP a Wialon (login,
-- búsqueda de unidades, telemetría, links de Locator, diagnóstico), con su
-- duración, su error y si se reintentó. Una consulta de la ficha puede
-- generar varias filas acá (una por intento). Nunca bloquea nada: si el
-- insert falla, la operación contra Wialon sigue igual — a diferencia de
-- gps_consulta_logs, que es fail-closed a propósito.
--
-- ── Parte 1: bitácora técnica por intento ────────────────────────────────────

DO $$ BEGIN
	CREATE TYPE "gps_integracion_resultado" AS ENUM ('ok', 'error', 'reintentado', 'incierto');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "gps_integracion_severidad" AS ENUM ('info', 'warning', 'critical');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gps_integracion_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"intento" integer DEFAULT 1 NOT NULL,
	"operacion" text NOT NULL,
	"origen" text NOT NULL,
	"resultado" "gps_integracion_resultado" NOT NULL,
	"error_code" text,
	"wialon_error_code" integer,
	"http_status" integer,
	"severidad" "gps_integracion_severidad" DEFAULT 'info' NOT NULL,
	"duracion_ms" integer NOT NULL,
	"request_resumen" jsonb,
	"response_resumen" jsonb,
	"user_id" text,
	"vehicle_id" uuid,
	"numero_credito_sifco" text,
	"gps_consulta_log_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_integracion_logs"
		ADD CONSTRAINT "gps_integracion_logs_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_integracion_logs"
		ADD CONSTRAINT "gps_integracion_logs_gps_consulta_log_id_gps_consulta_logs_id_fk"
		FOREIGN KEY ("gps_consulta_log_id") REFERENCES "public"."gps_consulta_logs"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_integracion_logs_created_at" ON "gps_integracion_logs" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_integracion_logs_resultado_created_at" ON "gps_integracion_logs" ("resultado", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_integracion_logs_correlation" ON "gps_integracion_logs" ("correlation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_integracion_logs_sifco" ON "gps_integracion_logs" ("numero_credito_sifco");
--> statement-breakpoint

-- ── Parte 2: ciclo de vida de alertas de falla ───────────────────────────────
--
-- Una fila por alerta ABIERTA por tipo+error_code (índice único parcial): el
-- job de salud reutiliza la misma fila mientras el problema persiste
-- (incrementa ocurrencias y actualiza ultima_vez) en vez de crear una
-- notificación nueva cada 5 minutos. Al resolverse (automático para
-- umbrales, manual para errores críticos) queda cerrada con quién y cuándo.

DO $$ BEGIN
	CREATE TYPE "gps_alerta_tipo" AS ENUM ('error_critico', 'tasa_error', 'fallos_consecutivos', 'latencia_sla');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "gps_alerta_estado" AS ENUM ('abierta', 'resuelta');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gps_integracion_alertas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "gps_alerta_tipo" NOT NULL,
	"error_code" text,
	"detalle" text NOT NULL,
	"estado" "gps_alerta_estado" DEFAULT 'abierta' NOT NULL,
	"primera_vez" timestamp DEFAULT now() NOT NULL,
	"ultima_vez" timestamp DEFAULT now() NOT NULL,
	"ocurrencias" integer DEFAULT 1 NOT NULL,
	"resuelta_por" text,
	"resuelta_at" timestamp,
	"nota_resolucion" text
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "gps_integracion_alertas"
		ADD CONSTRAINT "gps_integracion_alertas_resuelta_por_user_id_fk"
		FOREIGN KEY ("resuelta_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_integracion_alertas_estado" ON "gps_integracion_alertas" ("estado");
--> statement-breakpoint
-- Una alerta abierta por tipo+error_code: el job hace upsert sobre esto en
-- vez de duplicar notificaciones para el mismo problema en curso.
-- COALESCE: sin él Postgres trata los NULL como distintos y las alertas de
-- umbral (error_code NULL) se duplicarían ante inserts simultáneos.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_gps_integracion_alertas_abierta_unica" ON "gps_integracion_alertas" ("tipo", COALESCE("error_code", '')) WHERE "estado" = 'abierta';
--> statement-breakpoint

-- ── Parte 3: nuevo valor de redirect_page para notificar la alerta a admin ───
-- No lleva related_entity_id (no es una entidad del CRM), igual que pay_investors.
ALTER TYPE "notification_redirect_page" ADD VALUE IF NOT EXISTS 'admin_gps';
