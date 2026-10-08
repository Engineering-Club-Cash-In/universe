-- COBROS-02 · Ficha 360 rediseñada, backend (issue #1864,
-- docs/features/cobros-02/21-plan-backend-ficha-360.md).
--
-- F8 · Direcciones corregidas desde la ficha. NULL = la de origen (residencia
-- del lead, trabajo de la solicitud de crédito firmada); esas fuentes no se
-- pisan.
--
-- F3 · Bitácora de cambios de los datos del cliente hechos desde cobros:
-- campo, antes y después, quién y desde dónde. Append-only.
--
-- F6 · Solicitudes de documentos al supervisor.
--
-- F7 · Asistente IA: resumen del caso en caché y preguntas al asistente.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE "public"."casos_cobros"
	ADD COLUMN IF NOT EXISTS "direccion_residencia_cobros" text;
ALTER TABLE "public"."casos_cobros"
	ADD COLUMN IF NOT EXISTS "empresa_trabajo_cobros" text;
ALTER TABLE "public"."casos_cobros"
	ADD COLUMN IF NOT EXISTS "direccion_trabajo_cobros" text;

CREATE TABLE IF NOT EXISTS "public"."cambios_datos_cliente_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"campo" text NOT NULL,
	"categoria" text NOT NULL,
	"valor_anterior" text,
	"valor_nuevo" text,
	"origen" text NOT NULL,
	"realizado_por" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cambios_datos_cliente_categoria_check"
		CHECK ("categoria" IN ('contacto', 'direcciones', 'datos_personales')),
	CONSTRAINT "cambios_datos_cliente_origen_check"
		CHECK ("origen" IN ('ficha_360', 'workspace', 'carga_masiva', 'sistema'))
);

CREATE INDEX IF NOT EXISTS "idx_cambios_datos_cliente_caso"
	ON "public"."cambios_datos_cliente_cobros" ("caso_cobro_id", "created_at" DESC);

-- F6 · Documentos que el asesor pide al supervisor (contrato, carta poder,
-- cambio de placas, expertaje). Se aprueban o rechazan con una nota. Una sola
-- pendiente por caso y documento.
CREATE TABLE IF NOT EXISTS "public"."solicitudes_documentos_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"numero_credito_sifco" text,
	"clave" text NOT NULL,
	"comentario" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"solicitado_por" text NOT NULL REFERENCES "public"."user"("id"),
	"solicitado_en" timestamp DEFAULT now() NOT NULL,
	"resuelto_por" text REFERENCES "public"."user"("id"),
	"resuelto_en" timestamp,
	"nota_resolucion" text,
	CONSTRAINT "solicitudes_documentos_clave_check"
		CHECK ("clave" IN ('contrato', 'carta-poder', 'cambio-placas', 'expertaje')),
	CONSTRAINT "solicitudes_documentos_estado_check"
		CHECK ("estado" IN ('pendiente', 'aprobada', 'rechazada'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_solicitud_documento_pendiente"
	ON "public"."solicitudes_documentos_cobros" ("caso_cobro_id", "clave")
	WHERE "estado" = 'pendiente';

CREATE INDEX IF NOT EXISTS "idx_solicitudes_documentos_estado"
	ON "public"."solicitudes_documentos_cobros" ("estado", "solicitado_en" DESC);

-- F7 · Resumen del caso por IA, uno por caso. Se regenera solo si cambia la
-- huella de los datos que se le mandaron al modelo.
CREATE TABLE IF NOT EXISTS "public"."resumenes_ia_cobros" (
	"caso_cobro_id" uuid PRIMARY KEY NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"texto" text NOT NULL,
	"etiquetas" text[] DEFAULT '{}' NOT NULL,
	"huella" text NOT NULL,
	"modelo" text NOT NULL,
	"generado_en" timestamp DEFAULT now() NOT NULL
);

-- F7 · Preguntas al asistente: traza y tope diario por usuario.
CREATE TABLE IF NOT EXISTS "public"."preguntas_ia_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL REFERENCES "public"."casos_cobros"("id") ON DELETE CASCADE,
	"pregunta" text NOT NULL,
	"respuesta" text,
	"ok" boolean DEFAULT true NOT NULL,
	"modelo" text NOT NULL,
	"realizada_por" text NOT NULL REFERENCES "public"."user"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_preguntas_ia_usuario_fecha"
	ON "public"."preguntas_ia_cobros" ("realizada_por", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_preguntas_ia_caso"
	ON "public"."preguntas_ia_cobros" ("caso_cobro_id", "created_at" DESC);
