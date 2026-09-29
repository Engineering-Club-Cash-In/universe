-- CB-037 / CB-038 — Visitas de cobros: a la residencia y al lugar de trabajo.
--
-- Hasta acá "Visita" era una opción más del dropdown "Registrar Contacto" que
-- abría el formulario genérico de contacto: no pedía dirección, responsable ni
-- evidencia. Ahora la visita es una TAREA con dos momentos:
--
--   · programada → alguien la agenda: dirección, responsable y fecha. Ese día
--     le llega un aviso al responsable.
--   · realizada  → se registra el resultado (pago, promesa, 50% + promesa,
--     entrega voluntaria o sin contacto), la evidencia y el próximo paso.
--     También se puede registrar directo, sin haberla programado.
--   · cancelada  → la programada no se hizo.
--
-- La visita realizada deja además su fila en `contactos_cobros` (la gestión),
-- para que cuente en el historial, la agenda y el cierre diario como cualquier
-- otra. Los vínculos viven en ESTA tabla y no en las otras:
--   · contacto_cobro_id   → la gestión que dejó la visita;
--   · promesa_contacto_id → la promesa registrada a partir de la visita;
--   · recuperacion_id     → la entrega voluntaria (CB-042) que salió de ella.
-- Así ni `contactos_cobros` ni `recuperaciones_vehiculo` cambian, y si cartera
-- rechaza el traslado de una entrega (el registro se borra) el vínculo se
-- limpia solo (ON DELETE SET NULL).
--
-- `tipo` y `estado` van con CHECK: son la forma de la tabla. `resultado` y
-- `motivo_sin_contacto` en text validado en TypeScript (lib/visitas-cobros.ts):
-- el catálogo es del ticket y puede cambiar sin migración.
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS "visitas_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"estado" text NOT NULL,
	-- Dónde: lo que el asesor confirmó (viene precargado de la solicitud de
	-- crédito o del lead, y lo puede corregir).
	"direccion" text NOT NULL,
	"referencia" text,
	"empresa" text,
	-- Quién va. Puede no ser quien registra (un supervisor programa al asesor).
	"responsable_id" text NOT NULL,
	-- Programación (null si se registró directo, ya hecha).
	"fecha_programada" timestamp,
	"notas_programacion" text,
	"programada_por" text,
	-- Resultado (solo realizada).
	"fecha_visita" timestamp,
	"resultado" text,
	"motivo_sin_contacto" text,
	"monto_recibido" numeric(12, 2),
	"comentarios" text,
	"proximo_paso" text,
	-- Dónde estaba el celular del asesor al registrar (opcional, con permiso
	-- del navegador): respaldo de que la visita ocurrió.
	"ubicacion_lat" numeric(10, 7),
	"ubicacion_lng" numeric(10, 7),
	"ubicacion_precision_m" integer,
	"registrada_por" text,
	-- Cancelación (solo cancelada).
	"motivo_cancelacion" text,
	"cancelada_por" text,
	"cancelada_at" timestamp,
	-- Vínculos (ver encabezado).
	"contacto_cobro_id" uuid,
	"promesa_contacto_id" uuid,
	"recuperacion_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "visitas_cobros_tipo_check" CHECK ("tipo" IN ('residencia', 'trabajo')),
	CONSTRAINT "visitas_cobros_estado_check" CHECK ("estado" IN ('programada', 'realizada', 'cancelada')),
	-- Una realizada tiene fecha y resultado; una programada, fecha programada.
	CONSTRAINT "visitas_cobros_realizada_check" CHECK (
		"estado" <> 'realizada' OR ("fecha_visita" IS NOT NULL AND "resultado" IS NOT NULL)
	),
	CONSTRAINT "visitas_cobros_programada_check" CHECK (
		"estado" <> 'programada' OR "fecha_programada" IS NOT NULL
	)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_caso_cobro_id_casos_cobros_id_fk"
		FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_responsable_id_user_id_fk"
		FOREIGN KEY ("responsable_id") REFERENCES "public"."user"("id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_programada_por_user_id_fk"
		FOREIGN KEY ("programada_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_registrada_por_user_id_fk"
		FOREIGN KEY ("registrada_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_cancelada_por_user_id_fk"
		FOREIGN KEY ("cancelada_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_contacto_cobro_id_contactos_cobros_id_fk"
		FOREIGN KEY ("contacto_cobro_id") REFERENCES "public"."contactos_cobros"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_promesa_contacto_id_contactos_cobros_id_fk"
		FOREIGN KEY ("promesa_contacto_id") REFERENCES "public"."contactos_cobros"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros"
		ADD CONSTRAINT "visitas_cobros_recuperacion_id_recuperaciones_vehiculo_id_fk"
		FOREIGN KEY ("recuperacion_id") REFERENCES "public"."recuperaciones_vehiculo"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitas_cobros_caso_fecha_idx"
	ON "visitas_cobros" ("caso_cobro_id", "created_at" DESC);
--> statement-breakpoint
-- El aviso de la mañana busca las programadas del día.
CREATE INDEX IF NOT EXISTS "visitas_cobros_programadas_idx"
	ON "visitas_cobros" ("fecha_programada")
	WHERE "estado" = 'programada';
--> statement-breakpoint
-- La evidencia: fotos en R2 (privadas, se sirven con URL firmada).
CREATE TABLE IF NOT EXISTS "visitas_cobros_evidencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visita_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"nombre_archivo" text NOT NULL,
	"mime_type" text NOT NULL,
	"tamano_bytes" integer NOT NULL,
	"subido_por" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "visitas_cobros_evidencias_r2_key_unique" UNIQUE ("r2_key")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros_evidencias"
		ADD CONSTRAINT "visitas_cobros_evidencias_visita_id_visitas_cobros_id_fk"
		FOREIGN KEY ("visita_id") REFERENCES "public"."visitas_cobros"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visitas_cobros_evidencias"
		ADD CONSTRAINT "visitas_cobros_evidencias_subido_por_user_id_fk"
		FOREIGN KEY ("subido_por") REFERENCES "public"."user"("id") ON DELETE SET NULL;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitas_cobros_evidencias_visita_idx"
	ON "visitas_cobros_evidencias" ("visita_id");
--> statement-breakpoint
-- La visita al trabajo como canal propio en el historial (la de residencia
-- sigue siendo `visita_domicilio`). Aditivo: no reescribe tablas.
ALTER TYPE "metodo_contacto" ADD VALUE IF NOT EXISTS 'visita_trabajo';
--> statement-breakpoint
-- Aviso al responsable de una visita programada: al programarla (si la
-- programó otro) y la mañana del día.
ALTER TYPE "cobros_notif_tipo" ADD VALUE IF NOT EXISTS 'visita_programada';
