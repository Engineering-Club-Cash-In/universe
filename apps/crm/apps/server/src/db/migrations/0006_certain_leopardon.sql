CREATE TYPE "public"."auction_status" AS ENUM('pending', 'sold');--> statement-breakpoint
CREATE TYPE "public"."credit_type" AS ENUM('autocompra', 'sobre_vehiculo');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('lead', 'opportunity', 'client', 'company', 'vehicle', 'vendor', 'contract', 'collection_case');--> statement-breakpoint
CREATE TYPE "public"."note_type" AS ENUM('general', 'follow_up', 'important', 'internal');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('draft', 'sent', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('particular', 'uber', 'pickup', 'nuevo', 'panel', 'camion', 'microbus');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('pending', 'approved', 'rejected', 'auction');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('pending', 'available', 'sold', 'maintenance', 'auction');--> statement-breakpoint
ALTER TYPE "public"."work_time" ADD VALUE 'less_than_1' BEFORE '1_to_5';--> statement-breakpoint
CREATE TABLE "auction_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"description" text NOT NULL,
	"status" "auction_status" DEFAULT 'pending' NOT NULL,
	"market_value" numeric(12, 2) NOT NULL,
	"auction_price" numeric(12, 2),
	"loss_value" numeric(12, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_type" "credit_type" NOT NULL,
	"document_type" "document_type" NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "document_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"validated_by" text NOT NULL,
	"validated_at" timestamp DEFAULT now() NOT NULL,
	"all_documents_present" boolean NOT NULL,
	"vehicle_inspected" boolean NOT NULL,
	"missing_documents" text[],
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "insurance_costs" (
	"price" integer PRIMARY KEY NOT NULL,
	"inrexsa" numeric(10, 2) NOT NULL,
	"pick_up" numeric(10, 2) NOT NULL,
	"panel_camion_microbus" numeric(10, 2) NOT NULL,
	"membership" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "miniagent_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "miniagent_credentials_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "entity_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"content" text NOT NULL,
	"note_type" "note_type" DEFAULT 'general' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"edited_by" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_by" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "note_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"file_path" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"opportunity_id" uuid,
	"vehicle_id" uuid,
	"sales_user_id" text NOT NULL,
	"vehicle_brand" text,
	"vehicle_line" text,
	"vehicle_model" text,
	"vehicle_type" "vehicle_type" DEFAULT 'particular' NOT NULL,
	"vehicle_value" numeric(12, 2) NOT NULL,
	"insured_amount" numeric(12, 2) NOT NULL,
	"down_payment" numeric(12, 2) NOT NULL,
	"down_payment_percentage" numeric(5, 2) NOT NULL,
	"term_months" integer NOT NULL,
	"interest_rate" numeric(5, 2) NOT NULL,
	"insurance_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gps_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"transfer_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"admin_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"membership_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_to_finance" numeric(12, 2) NOT NULL,
	"total_financed" numeric(12, 2) NOT NULL,
	"monthly_payment" numeric(12, 2) NOT NULL,
	"status" "quotation_status" DEFAULT 'draft' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."inspection_status";--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ALTER COLUMN "status" SET DATA TYPE "public"."inspection_status" USING "status"::"public"."inspection_status";--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."vehicle_status";--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "status" SET DATA TYPE "public"."vehicle_status" USING "status"::"public"."vehicle_status";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "casos_cobros" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "contratos_financiamiento" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "bank_statements_2" text;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD COLUMN "bank_statements_3" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "credit_type" "credit_type" DEFAULT 'autocompra' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "numero_cuotas" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "tasa_interes" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "cuota_mensual" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "fecha_inicio" timestamp;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "dia_pago_mensual" integer;--> statement-breakpoint
ALTER TABLE "vehicle_vendors" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "auction_expenses" ADD CONSTRAINT "auction_expenses_auction_id_auction_vehicles_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auction_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_vehicles" ADD CONSTRAINT "auction_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_validations" ADD CONSTRAINT "document_validations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_validations" ADD CONSTRAINT "document_validations_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "miniagent_credentials" ADD CONSTRAINT "miniagent_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_notes" ADD CONSTRAINT "entity_notes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_notes" ADD CONSTRAINT "entity_notes_edited_by_user_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_notes" ADD CONSTRAINT "entity_notes_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachments" ADD CONSTRAINT "note_attachments_note_id_entity_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."entity_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_attachments" ADD CONSTRAINT "note_attachments_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sales_user_id_user_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;