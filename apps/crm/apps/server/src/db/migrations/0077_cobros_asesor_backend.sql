-- COBROS-02 · Dashboard del asesor y Mi Cartera, backend (issue #1862,
-- docs/features/cobros-02/20-plan-backend-asesor.md).
--
-- B8 · Hora y medio del próximo contacto. `fecha_proximo_contacto` sigue
-- guardando el DÍA (medianoche GT): todas las comparaciones por día que ya
-- existen siguen igual. La hora va aparte y solo se llena en gestiones que no
-- son promesa (las promesas siguen por día).
--
-- Participante contactado. La racha de intentos sin contacto (B7) es «al
-- titular»: un intento a un codeudor o a una referencia no cuenta. NULL =
-- titular (gestiones anteriores).
--
-- B3 · Metas de recuperación por asesor, en quetzales y por mes. `asesor_id`
-- es el id del asesor en cartera-back (`asesores.asesor_id`), el mismo que usa
-- el pool de buckets. Una fila por asesor y mes (índice único para el upsert).
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE "public"."contactos_cobros"
	ADD COLUMN IF NOT EXISTS "hora_proximo_contacto" time;
--> statement-breakpoint
ALTER TABLE "public"."contactos_cobros"
	ADD COLUMN IF NOT EXISTS "medio_proximo_contacto" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public"."contactos_cobros"
		ADD CONSTRAINT "contactos_cobros_medio_proximo_contacto_check"
		CHECK ("medio_proximo_contacto" IS NULL OR "medio_proximo_contacto" IN ('llamada', 'whatsapp'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "public"."contactos_cobros"
	ADD COLUMN IF NOT EXISTS "participante_tipo" text;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "public"."contactos_cobros"
		ADD CONSTRAINT "contactos_cobros_participante_tipo_check"
		CHECK ("participante_tipo" IS NULL OR "participante_tipo" IN ('titular', 'codeudor', 'referencia'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."metas_asesor_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asesor_id" integer NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"monto_recuperacion" numeric(14, 2) NOT NULL,
	"actualizado_por" text REFERENCES "public"."user"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "metas_asesor_cobros_asesor_mes_unique" UNIQUE ("asesor_id", "anio", "mes"),
	CONSTRAINT "metas_asesor_cobros_mes_check" CHECK ("mes" BETWEEN 1 AND 12),
	CONSTRAINT "metas_asesor_cobros_monto_check" CHECK ("monto_recuperacion" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_metas_asesor_cobros_periodo"
	ON "public"."metas_asesor_cobros" ("anio", "mes");
