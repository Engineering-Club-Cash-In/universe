CREATE TABLE IF NOT EXISTS "gyt_insurance_costs" (
	"price" integer PRIMARY KEY NOT NULL,
	"current_automovil_camioneta" numeric(16, 8),
	"automovil_camioneta" numeric(16, 8),
	"current_microbus" numeric(16, 8),
	"microbus" numeric(16, 8),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "gyt_insurance_costs"
	ADD COLUMN IF NOT EXISTS "current_automovil_camioneta" numeric(16, 8),
	ADD COLUMN IF NOT EXISTS "current_microbus" numeric(16, 8);

ALTER TABLE "quotations"
	ADD COLUMN IF NOT EXISTS "insurance_provider" text DEFAULT 'universales' NOT NULL,
	ADD COLUMN IF NOT EXISTS "customer_insurance_cost" numeric(16, 8),
	ADD COLUMN IF NOT EXISTS "internal_insurance_cost" numeric(16, 8),
	ADD COLUMN IF NOT EXISTS "insurance_savings_to_membership" numeric(16, 8) DEFAULT '0' NOT NULL;

ALTER TABLE "opportunities"
	ADD COLUMN IF NOT EXISTS "insurance_provider" text DEFAULT 'universales' NOT NULL,
	ADD COLUMN IF NOT EXISTS "customer_insurance_cost" numeric(16, 8),
	ADD COLUMN IF NOT EXISTS "internal_insurance_cost" numeric(16, 8),
	ADD COLUMN IF NOT EXISTS "insurance_savings_to_membership" numeric(16, 8) DEFAULT '0' NOT NULL;
