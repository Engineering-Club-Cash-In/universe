CREATE TYPE "public"."analysis_status" AS ENUM('not_applicable', 'pending', 'rejected', 'resubmitted', 'approved');--> statement-breakpoint
CREATE TYPE "public"."credit_category" AS ENUM('Contraseña', 'CV Vehículo', 'CV Vehículo nuevo', 'Fiduciario', 'Hipotecario', 'Vehículo');--> statement-breakpoint
CREATE TYPE "public"."disbursement_verification_type" AS ENUM('traspaso_realizado', 'documentos_enviados_asesor', 'documentos_firmados_recibidos', 'copia_llave_recibida', 'enganche_validado', 'listo_desembolsar');--> statement-breakpoint
CREATE TYPE "public"."inspection_360_status" AS ENUM('ok', 'bad');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'sales_supervisor' BEFORE 'analyst';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'cobros_supervisor' BEFORE 'juridico';--> statement-breakpoint
ALTER TYPE "public"."lead_status" ADD VALUE 'migrate';--> statement-breakpoint
ALTER TYPE "public"."opportunity_status" ADD VALUE 'migrate';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'datos_vehiculo_nuevo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'cotizacion_vehiculo_nuevo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'usuario_sat_cliente' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'rtu_cliente' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'omisos_incumplimientos_cliente' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'infornet' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'confirmacion_referencias' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'visita_domiciliar' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'redes_sociales_internet' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'enganche' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'usuario_sat_propietario' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'rtu_propietario' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'omisos_incumplimientos_propietario' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'garantia_mobiliaria_sat' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'garantia_mobiliaria_dpi' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'garantia_mobiliaria_nit' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'garantia_mobiliaria_serie' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'multas_vehiculo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'seguro_vehiculo' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'inscripcion_garantia_mobiliaria' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'traspaso' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'documentos_firmados_vendedor' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'copia_llave' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'confirmacion_enganche' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'desembolso' BEFORE 'identification';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'detalle_analisis';--> statement-breakpoint
CREATE TABLE "infornet_persona_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo_persona" integer NOT NULL,
	"dpi" text,
	"nombres" text NOT NULL,
	"apellidos" text NOT NULL,
	"fecha_nacimiento" text,
	"sexo" text,
	"estudio_completo" jsonb NOT NULL,
	"tiene_referencias_comerciales" boolean DEFAULT false NOT NULL,
	"tiene_referencias_judiciales" boolean DEFAULT false NOT NULL,
	"es_pep" boolean DEFAULT false NOT NULL,
	"cantidad_inmuebles" integer DEFAULT 0 NOT NULL,
	"cantidad_vehiculos" integer DEFAULT 0 NOT NULL,
	"cantidad_empresas" integer DEFAULT 0 NOT NULL,
	"consultado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"consultado_por" text,
	"motivo_consulta" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "infornet_persona_cache_codigo_persona_unique" UNIQUE("codigo_persona"),
	CONSTRAINT "infornet_persona_cache_dpi_unique" UNIQUE("dpi")
);
--> statement-breakpoint
CREATE TABLE "credit_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid,
	"quotation_id" uuid,
	"check_date" timestamp NOT NULL,
	"issuer" text NOT NULL,
	"issuer_bank" text,
	"beneficiary" text NOT NULL,
	"account_number" text,
	"transfer_type" text DEFAULT 'TRANSFERENCIA' NOT NULL,
	"account_type" text DEFAULT 'MONETARIA',
	"beneficiary_bank" text,
	"concept" text NOT NULL,
	"currency" text DEFAULT 'GTQ' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disbursement_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"traspaso_realizado" boolean DEFAULT false,
	"documentos_enviados_asesor" boolean DEFAULT false,
	"documentos_firmados_recibidos" boolean DEFAULT false,
	"copia_llave_recibida" boolean DEFAULT false,
	"enganche_validado" boolean DEFAULT false,
	"listo_desembolsar" boolean DEFAULT false,
	"notes" text,
	"completed_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "disbursement_checklists_opportunity_id_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "contract_generation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"contract_date" timestamp NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guatemala_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"departamento" text NOT NULL,
	"municipio" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspection_360_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"area" text NOT NULL,
	"checkpoint" text NOT NULL,
	"status" "inspection_360_status" NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"dpi" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "casos_cobros" ALTER COLUMN "contrato_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "company_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ALTER COLUMN "uploaded_by" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "license_plate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "vin_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "km_mileage" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "km_mileage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "origin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "cylinders" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "engine_cc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "fuel_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "transmission" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "middle_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "second_last_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "nit" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "direccion" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "departamento" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "municipio" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "zona" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "birth_date" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "source" "lead_source";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "loan_purpose" "loan_purpose";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "seguro" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "gps" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "categoria" "credit_category";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "nit" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "royalti" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "porcentaje_royalti" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "reserva" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "membresia_pago" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "inversionistas" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "asesor_id" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "numero_sifco" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "rubros" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "gastos_administrativos" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "credit_detail_approved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "credit_detail_approved_by" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "credit_detail_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "disbursement_approved" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "disbursement_approved_by" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "disbursement_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "analysis_status" "analysis_status" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "analysis_rejection_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "last_analysis_rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "last_analysis_rejected_by" text;--> statement-breakpoint
ALTER TABLE "generated_legal_contracts" ADD COLUMN "pdf_link" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "freelance_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "freelance_percentage" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "royalty" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "royalty_percentage" numeric(5, 2) DEFAULT '4.00';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "inspection_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "fines_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "key_copy_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "key_copy_diff_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "circulation_tax_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "mobile_guarantee_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "license_plates_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "leasing_contract_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "collection_auth_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "legal_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "appointment_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "address_verification_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "extra_gps_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "extra_insurance_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "extra_membership_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "extra_admin_cost" numeric(12, 2) DEFAULT '600';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "interest_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "vehicle_transfer_cost" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD COLUMN "tires_condition" integer;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD COLUMN "paint_condition" integer;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD COLUMN "has_agency_history" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD COLUMN "section_times" json DEFAULT '{}'::json;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "is_new" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "motor_number" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "seats" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "doors" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "axles" integer DEFAULT 2;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vehicle_use" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "series" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "iscv_code" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "trim" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "traction" text;--> statement-breakpoint
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_checks" ADD CONSTRAINT "credit_checks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_checklists" ADD CONSTRAINT "disbursement_checklists_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disbursement_checklists" ADD CONSTRAINT "disbursement_checklists_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_generation_snapshots" ADD CONSTRAINT "contract_generation_snapshots_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_generation_snapshots" ADD CONSTRAINT "contract_generation_snapshots_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspection_360_items" ADD CONSTRAINT "vehicle_inspection_360_items_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otps" ADD CONSTRAINT "otps_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "infornet_persona_dpi_idx" ON "infornet_persona_cache" USING btree ("dpi");--> statement-breakpoint
CREATE INDEX "infornet_persona_codigo_idx" ON "infornet_persona_cache" USING btree ("codigo_persona");--> statement-breakpoint
CREATE INDEX "infornet_persona_expira_idx" ON "infornet_persona_cache" USING btree ("expira_en");--> statement-breakpoint
CREATE UNIQUE INDEX "dept_muni_unique_idx" ON "guatemala_locations" USING btree ("departamento","municipio");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_credit_detail_approved_by_user_id_fk" FOREIGN KEY ("credit_detail_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_disbursement_approved_by_user_id_fk" FOREIGN KEY ("disbursement_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_last_analysis_rejected_by_user_id_fk" FOREIGN KEY ("last_analysis_rejected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "loan_purpose";