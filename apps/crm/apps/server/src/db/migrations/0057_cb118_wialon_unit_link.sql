-- CB-118 — GPS/Wialon en la Ficha 360: vínculo vehículo↔unidad y auditoría.
--
-- ── Parte 1: vínculo entre el vehículo del CRM y su unidad en Wialon ─────────
--
-- La Ficha 360 necesita mostrar última ubicación, velocidad y estado del motor
-- del vehículo de un crédito, pero hasta ahora nada relacionaba un `vehicles.id`
-- con un `unitId` de Wialon. Los campos GPS que ya existían (`gps_activo`,
-- `imei_gps`, `ubicacion_actual_gps`, `ultima_señal_gps`) nunca se conectaron al
-- proveedor: los llena el cargador de CSV y se quedan ahí.
--
-- El nombre de la unidad en Wialon suele traer la placa ("Bidgar Yatz - C-629BNC"),
-- así que el vínculo se resuelve solo la primera vez y se fija acá. Pero hay
-- unidades nombradas "A-04", sin placa, y puede haber varias que coincidan: en
-- esos casos no se adivina, un supervisor elige la unidad desde la ficha y queda
-- registrado quién y cuándo (`wialon_vinculado_por` / `wialon_vinculado_at`).
-- Cuando lo deduce el sistema, `wialon_vinculado_por` = 'auto:placa'.
--
-- `wialon_unit_id` NO lleva UNIQUE a propósito: tras una recuperación la misma
-- unidad física puede reasignarse a otro vehículo, y un índice único convertiría
-- ese cambio legítimo en un error de escritura.

ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "wialon_unit_id" integer;
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "wialon_unit_name" text;
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "wialon_vinculado_at" timestamp;
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "wialon_vinculado_por" text;
--> statement-breakpoint

-- ── Parte 2: auditoría de consultas de ubicación GPS ─────────────────────────
--
-- La historia lo exige explícitamente: "cada consulta queda auditada con
-- usuario, motivo y cuenta". Vincular una unidad (arriba) y generar un enlace
-- de Locator ya quedaban auditados (WIALON_UNIDAD_VINCULADA,
-- WIALON_LOCATOR_LINK_CREATED); esto audita el acto de simplemente VER la
-- ubicación, que antes pasaba sin dejar rastro ni pedir motivo.
--
-- Un registro por cada vez que el asesor confirma un motivo y pide ver la
-- telemetría — nunca por un refresco automático (no existe: sin motivo nuevo
-- no hay consulta que auditar).
--
-- vehicle_id y numero_credito_sifco quedan sin FK a propósito (mismo patrón
-- que cobros_send_logs.numero_credito_sifco): la relación puede cambiar de
-- dueño con el tiempo, y la auditoría debe seguir diciendo para qué cuenta
-- se consultó EN ESE MOMENTO, no lo que sea hoy.

CREATE TABLE IF NOT EXISTS "gps_consulta_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"numero_credito_sifco" text,
	"motivo" text NOT NULL,
	"unit_id" text,
	"unit_name" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Envuelto en DO/EXCEPTION porque ADD CONSTRAINT no admite IF NOT EXISTS: así
-- la migración entera se puede re-ejecutar igual que los CREATE ... IF NOT EXISTS.
DO $$ BEGIN
	ALTER TABLE "gps_consulta_logs"
		ADD CONSTRAINT "gps_consulta_logs_user_id_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE RESTRICT;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_consulta_logs_vehicle" ON "gps_consulta_logs" ("vehicle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_consulta_logs_sifco" ON "gps_consulta_logs" ("numero_credito_sifco");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gps_consulta_logs_created_at" ON "gps_consulta_logs" ("created_at");
