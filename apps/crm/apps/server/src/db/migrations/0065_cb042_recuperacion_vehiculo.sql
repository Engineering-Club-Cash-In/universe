-- CB-042 — Los dos envíos a recuperación de vehículo, con su formulario.
--
-- Hasta acá "mandar a recuperación" era un botón con un motivo en texto libre:
-- el crédito llegaba a B4 y el asesor de B4 no sabía por qué ni dónde estaba
-- la unidad. Ahora hay dos tipos de envío y cada uno deja registro en el CRM:
--
--   · tipo_recuperacion = 'tomado'              → recuperación forzosa: el
--     asesor decide quitar la unidad (motivos, dónde está, en qué estado).
--   · tipo_recuperacion = 'entrega_voluntaria'  → el cliente la entrega: además
--     fecha, lugar, quién entrega y qué documentos.
--
-- Se reusa `recuperaciones_vehiculo`, que ya existía con esos tipos pero que
-- nadie llenaba (0 filas en dev y en prod al 2026-09-28). Las columnas viejas
-- se conservan con el mismo sentido: `fecha_recuperacion` + `completada` son
-- la recepción de la unidad, y `responsable_recuperacion` el asesor de B4.
--
-- Catálogos (motivos, estado del vehículo, documentos) en text validado en
-- TypeScript (lib/recuperacion-vehiculo.ts), no en enum nativo: son
-- provisionales y un enum no se puede recortar en caliente.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE "recuperaciones_vehiculo"
	ADD COLUMN IF NOT EXISTS "motivos" text[] DEFAULT '{}' NOT NULL,
	ADD COLUMN IF NOT EXISTS "motivo_detalle" text,
	-- true = este registro movió el crédito a B4. false = se registró con el
	-- crédito ya en B4 (entrega voluntaria desde B4, sin traslado).
	ADD COLUMN IF NOT EXISTS "trasladado" boolean DEFAULT false NOT NULL,
	ADD COLUMN IF NOT EXISTS "bucket_origen" integer,
	ADD COLUMN IF NOT EXISTS "bucket_destino" integer,
	-- Dónde está la unidad al registrar. `ubicacion_fuente` = 'manual' | 'gps'.
	ADD COLUMN IF NOT EXISTS "ubicacion_direccion" text,
	ADD COLUMN IF NOT EXISTS "ubicacion_enlace" text,
	ADD COLUMN IF NOT EXISTS "ubicacion_lat" numeric(10, 7),
	ADD COLUMN IF NOT EXISTS "ubicacion_lng" numeric(10, 7),
	ADD COLUMN IF NOT EXISTS "ubicacion_fuente" text,
	ADD COLUMN IF NOT EXISTS "gps_unidad" text,
	ADD COLUMN IF NOT EXISTS "gps_senal_at" timestamp,
	ADD COLUMN IF NOT EXISTS "estado_vehiculo" text,
	ADD COLUMN IF NOT EXISTS "estado_vehiculo_detalle" text,
	ADD COLUMN IF NOT EXISTS "kilometraje" integer,
	-- Entrega voluntaria.
	ADD COLUMN IF NOT EXISTS "fecha_entrega" timestamp,
	ADD COLUMN IF NOT EXISTS "lugar_entrega" text,
	ADD COLUMN IF NOT EXISTS "entrega_persona" text,
	ADD COLUMN IF NOT EXISTS "entrega_relacion" text,
	ADD COLUMN IF NOT EXISTS "documentos" text[] DEFAULT '{}' NOT NULL,
	ADD COLUMN IF NOT EXISTS "documentos_otros" text,
	-- Foto del saldo tomada de cartera al registrar (cartera calcula, el CRM
	-- guarda la foto). Null si cartera no respondió.
	ADD COLUMN IF NOT EXISTS "saldo_pendiente" numeric(18, 2),
	ADD COLUMN IF NOT EXISTS "cuotas_vencidas" integer,
	ADD COLUMN IF NOT EXISTS "monto_vencido" numeric(18, 2),
	ADD COLUMN IF NOT EXISTS "monto_mora" numeric(18, 2),
	ADD COLUMN IF NOT EXISTS "total_para_ponerse_al_dia" numeric(18, 2),
	ADD COLUMN IF NOT EXISTS "saldo_tomado_at" timestamp,
	ADD COLUMN IF NOT EXISTS "registrado_por" text,
	-- Recepción de la unidad (solo en B4).
	ADD COLUMN IF NOT EXISTS "recepcion_lugar" text,
	ADD COLUMN IF NOT EXISTS "recepcion_estado_vehiculo" text,
	ADD COLUMN IF NOT EXISTS "recepcion_estado_detalle" text,
	ADD COLUMN IF NOT EXISTS "recepcion_kilometraje" integer,
	ADD COLUMN IF NOT EXISTS "recepcion_documentos" text[],
	ADD COLUMN IF NOT EXISTS "recepcion_documentos_otros" text,
	ADD COLUMN IF NOT EXISTS "recepcion_notas" text,
	ADD COLUMN IF NOT EXISTS "recepcion_registrada_por" text,
	ADD COLUMN IF NOT EXISTS "recepcion_registrada_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recuperaciones_vehiculo"
		ADD CONSTRAINT "recuperaciones_vehiculo_registrado_por_user_id_fk"
		FOREIGN KEY ("registrado_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "recuperaciones_vehiculo"
		ADD CONSTRAINT "recuperaciones_vehiculo_recepcion_registrada_por_user_id_fk"
		FOREIGN KEY ("recepcion_registrada_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recuperaciones_vehiculo_caso_fecha_idx"
	ON "recuperaciones_vehiculo" ("caso_cobro_id", "created_at" DESC);
--> statement-breakpoint
-- Aviso al asesor de B4 y a los cobros_supervisor cuando llega un crédito a
-- recuperación (o se registra una entrega voluntaria ya en B4).
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'recuperacion_vehiculo';
