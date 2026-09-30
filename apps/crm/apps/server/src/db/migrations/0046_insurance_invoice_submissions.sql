-- Factura del seguro subida desde el tracker y el correo a la aseguradora.
--
-- El archivo vive en opportunity_documents (document_type = 'seguro_vehiculo');
-- esta tabla registra a quién se envió y cómo terminó el envío. El UNIQUE por
-- oportunidad deja una sola factura: por ahora no hay reemplazo.
--
-- `intento` forma la llave de idempotencia de Resend: reintentar un envío de
-- resultado desconocido reusa la llave (Resend no lo duplica) y uno que falló
-- de verdad pasa al siguiente intento. `correo_asunto` y `correo_html` guardan
-- el correo exacto del intento, porque Resend exige el mismo contenido con la
-- misma llave.
--
-- `company_id` guarda la agencia desde la que se subió: la oportunidad puede
-- cambiar de agencia después y el CRM muestra "Subido desde <agencia>".
--
-- `opportunity_close_quotations` guarda la cotización con la que el cierre
-- armó el crédito: después del cierre se pueden crear o aceptar otras, y la
-- factura tiene que decir lo mismo que el crédito.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

CREATE TABLE IF NOT EXISTS "public"."insurance_invoice_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"company_id" uuid,
	"document_id" uuid NOT NULL,
	"insurance_provider" text NOT NULL,
	"recipients" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"error" text,
	"intento" integer DEFAULT 1 NOT NULL,
	"correo_asunto" text,
	"correo_html" text,
	"sent_at" timestamp,
	"submitted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_invoice_submissions_opportunity_id_unique" UNIQUE("opportunity_id"),
	CONSTRAINT "insurance_invoice_submissions_status_check" CHECK ("status" IN ('pendiente', 'enviado', 'fallido', 'sin_destinatario'))
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- RESTRICT: borrar la factura no puede borrar el registro del envío, o se
-- liberaría el UNIQUE y se podría subir y enviar otra.
DO $$ BEGIN
	ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_document_id_opportunity_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."opportunity_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."insurance_invoice_submissions" ADD CONSTRAINT "insurance_invoice_submissions_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "public"."opportunity_close_quotations" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"quotation_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."opportunity_close_quotations" ADD CONSTRAINT "opportunity_close_quotations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."opportunity_close_quotations" ADD CONSTRAINT "opportunity_close_quotations_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
