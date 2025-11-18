CREATE TYPE "public"."vehicle_owner_type" AS ENUM('individual', 'empresa_individual', 'sociedad_anonima');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'tarjeta_circulacion' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'titulo_propiedad' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'dpi_dueno' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'patente_comercio_vehiculo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'representacion_legal_vehiculo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'dpi_representante_legal_vehiculo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'pago_impuesto_circulacion' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'consulta_sat' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'consulta_garantias_mobiliarias' BEFORE 'identification';--> statement-breakpoint
CREATE TABLE "vehicle_document_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "vehicle_owner_type" NOT NULL,
	"document_type" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"document_type" text NOT NULL,
	"file_path" text NOT NULL,
	"description" text,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "owner_type" "vehicle_owner_type" DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;