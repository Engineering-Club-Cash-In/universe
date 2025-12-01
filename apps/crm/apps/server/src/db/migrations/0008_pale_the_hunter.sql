CREATE TYPE "public"."client_type" AS ENUM('individual', 'comerciante', 'empresa');--> statement-breakpoint
CREATE TYPE "public"."verification_type" AS ENUM('rtu_pep', 'rtu_empresa', 'revision_internet', 'confirmacion_referencias', 'confirmacion_trabajo', 'confirmacion_negocio', 'capacidad_pago', 'infornet', 'verificacion_direccion');--> statement-breakpoint
CREATE TABLE "cartera_back_feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"rollout_percentage" integer DEFAULT 0 NOT NULL,
	"allowed_users" text,
	"allowed_roles" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "cartera_back_feature_flags_flag_name_unique" UNIQUE("flag_name")
);
--> statement-breakpoint
CREATE TABLE "cartera_back_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid,
	"contrato_financiamiento_id" uuid,
	"cartera_credito_id" integer NOT NULL,
	"numero_credito_sifco" varchar(40) NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_status" text,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "cartera_back_references_numero_credito_sifco_unique" UNIQUE("numero_credito_sifco")
);
--> statement-breakpoint
CREATE TABLE "cartera_back_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"request_payload" text,
	"response_payload" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"user_id" text,
	"source" text DEFAULT 'crm' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pago_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cartera_pago_id" integer NOT NULL,
	"numero_credito_sifco" varchar(40) NOT NULL,
	"cuota_numero" integer NOT NULL,
	"monto_boleta" numeric(12, 2) NOT NULL,
	"fecha_pago" timestamp with time zone NOT NULL,
	"caso_cobro_id" uuid,
	"registrado_por" text NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"sync_error" text,
	CONSTRAINT "pago_references_cartera_pago_id_unique" UNIQUE("cartera_pago_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"checklist_data" jsonb NOT NULL,
	"completed_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_checklists_opportunity_id_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "document_requirements_by_client_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_type" "client_type" NOT NULL,
	"credit_type" "credit_type" NOT NULL,
	"document_type" "document_type" NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"description" text,
	"order" integer
);
--> statement-breakpoint
ALTER TABLE "document_requirements" ALTER COLUMN "document_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "document_requirements_by_client_type" ALTER COLUMN "document_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "opportunity_documents" ALTER COLUMN "document_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."document_type";--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('dpi', 'licencia', 'recibo_luz', 'recibo_adicional', 'formularios', 'estados_cuenta_1', 'estados_cuenta_2', 'estados_cuenta_3', 'patente_comercio', 'representacion_legal', 'constitucion_sociedad', 'patente_mercantil', 'iva_1', 'iva_2', 'iva_3', 'estado_financiero', 'clausula_consentimiento', 'minutas');--> statement-breakpoint
ALTER TABLE "document_requirements" ALTER COLUMN "document_type" SET DATA TYPE "public"."document_type" USING "document_type"::"public"."document_type";--> statement-breakpoint
ALTER TABLE "document_requirements_by_client_type" ALTER COLUMN "document_type" SET DATA TYPE "public"."document_type" USING "document_type"::"public"."document_type";--> statement-breakpoint
ALTER TABLE "opportunity_documents" ALTER COLUMN "document_type" SET DATA TYPE "public"."document_type" USING "document_type"::"public"."document_type";--> statement-breakpoint
ALTER TABLE "casos_cobros" ADD COLUMN "numero_credito_sifco" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "client_type" "client_type" DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "cartera_back_references" ADD CONSTRAINT "cartera_back_references_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cartera_back_references" ADD CONSTRAINT "cartera_back_references_contrato_financiamiento_id_contratos_financiamiento_id_fk" FOREIGN KEY ("contrato_financiamiento_id") REFERENCES "public"."contratos_financiamiento"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pago_references" ADD CONSTRAINT "pago_references_caso_cobro_id_casos_cobros_id_fk" FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_checklists" ADD CONSTRAINT "analysis_checklists_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_checklists" ADD CONSTRAINT "analysis_checklists_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;