CREATE TYPE "public"."loan_purpose" AS ENUM('personal', 'business');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('single', 'married', 'divorced', 'widowed');--> statement-breakpoint
CREATE TYPE "public"."occupation_type" AS ENUM('owner', 'employee');--> statement-breakpoint
CREATE TYPE "public"."work_time" AS ENUM('1_to_5', '5_to_10', '10_plus');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('identification', 'income_proof', 'bank_statement', 'business_license', 'property_deed', 'vehicle_title', 'credit_report', 'other');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'analyst';--> statement-breakpoint
CREATE TABLE "credit_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"full_analysis" text,
	"monthly_fixed_income" numeric(12, 2),
	"monthly_variable_income" numeric(12, 2),
	"monthly_fixed_expenses" numeric(12, 2),
	"monthly_variable_expenses" numeric(12, 2),
	"economic_availability" numeric(12, 2),
	"min_payment" numeric(12, 2),
	"max_payment" numeric(12, 2),
	"adjusted_payment" numeric(12, 2),
	"max_credit_amount" numeric(12, 2),
	"analyzed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "credit_analysis_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"is_override" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "opportunity_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"document_type" "document_type" NOT NULL,
	"description" text,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"file_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"technician_name" text NOT NULL,
	"inspection_date" timestamp NOT NULL,
	"inspection_result" text NOT NULL,
	"vehicle_rating" text NOT NULL,
	"market_value" numeric(12, 2) NOT NULL,
	"suggested_commercial_value" numeric(12, 2) NOT NULL,
	"bank_value" numeric(12, 2) NOT NULL,
	"current_condition_value" numeric(12, 2) NOT NULL,
	"vehicle_equipment" text NOT NULL,
	"important_considerations" text,
	"scanner_used" boolean DEFAULT false NOT NULL,
	"scanner_result_url" text,
	"airbag_warning" boolean DEFAULT false NOT NULL,
	"missing_airbag" text,
	"test_drive" boolean DEFAULT false NOT NULL,
	"no_test_drive_reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"alerts" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"inspection_id" uuid,
	"category" text NOT NULL,
	"photo_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"license_plate" text NOT NULL,
	"vin_number" text NOT NULL,
	"color" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"miles_mileage" integer,
	"km_mileage" integer NOT NULL,
	"origin" text NOT NULL,
	"cylinders" text NOT NULL,
	"engine_cc" text NOT NULL,
	"fuel_type" text NOT NULL,
	"transmission" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"company_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_license_plate_unique" UNIQUE("license_plate"),
	CONSTRAINT "vehicles_vin_number_unique" UNIQUE("vin_number")
);
--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "age" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "dpi" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "marital_status" "marital_status";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "dependents" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "monthly_income" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "loan_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "occupation" "occupation_type";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "work_time" "work_time";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "loan_purpose" "loan_purpose";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "owns_home" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "owns_vehicle" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "has_credit_card" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fit" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_analysis" ADD CONSTRAINT "credit_analysis_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_analysis" ADD CONSTRAINT "credit_analysis_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_from_stage_id_sales_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_to_stage_id_sales_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_stage_history" ADD CONSTRAINT "opportunity_stage_history_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_documents" ADD CONSTRAINT "opportunity_documents_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_documents" ADD CONSTRAINT "opportunity_documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;