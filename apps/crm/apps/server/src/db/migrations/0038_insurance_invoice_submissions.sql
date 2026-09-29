-- Factura del seguro subida desde el tracker y el correo a la aseguradora.
-- El archivo vive en opportunity_documents (document_type = 'seguro_vehiculo');
-- esta tabla registra a quién se envió y cómo terminó el envío.
-- El UNIQUE por oportunidad deja una sola factura: por ahora no hay reemplazo.
-- Idempotente y re-ejecutable: aplicarla de nuevo deja el esquema al día.

CREATE TABLE IF NOT EXISTS "public"."insurance_invoice_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"insurance_provider" text NOT NULL,
	"recipients" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"error" text,
	"sent_at" timestamp,
	"submitted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_invoice_submissions_opportunity_id_unique" UNIQUE("opportunity_id"),
	CONSTRAINT "insurance_invoice_submissions_status_check" CHECK ("status" IN ('pendiente', 'enviado', 'fallido', 'sin_destinatario'))
);--> statement-breakpoint

-- Intento de envío: forma la llave de idempotencia de Resend. Reintentar un
-- envío de resultado desconocido reusa la llave (Resend no lo duplica); un
-- envío que falló de verdad pasa al siguiente intento.
ALTER TABLE "public"."insurance_invoice_submissions" ADD COLUMN IF NOT EXISTS "intento" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- Correo exacto del intento: Resend exige el mismo contenido para no duplicar
-- con la misma llave, así que un reintento reenvía lo guardado en vez de
-- reconstruirlo con datos que pudieron cambiar.
ALTER TABLE "public"."insurance_invoice_submissions" ADD COLUMN IF NOT EXISTS "correo_asunto" text;--> statement-breakpoint
ALTER TABLE "public"."insurance_invoice_submissions" ADD COLUMN IF NOT EXISTS "correo_html" text;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- RESTRICT: borrar la factura no puede borrar el registro del envío, o se
-- liberaría el UNIQUE y se podría subir y enviar otra.
ALTER TABLE "public"."insurance_invoice_submissions" DROP CONSTRAINT IF EXISTS "insurance_invoice_submissions_document_id_opportunity_documents_id_fk";--> statement-breakpoint
ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_document_id_opportunity_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."opportunity_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
