CREATE TYPE "public"."contract_status" AS ENUM('pending', 'signed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'juridico';--> statement-breakpoint
CREATE TABLE "generated_legal_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"contract_type" text NOT NULL,
	"contract_name" text NOT NULL,
	"client_signing_link" text,
	"representative_signing_link" text,
	"additional_signing_links" text[],
	"template_id" integer,
	"api_response" jsonb,
	"status" "contract_status" DEFAULT 'pending' NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_legal_contracts" ADD CONSTRAINT "generated_legal_contracts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_legal_contracts" ADD CONSTRAINT "generated_legal_contracts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_legal_contracts" ADD CONSTRAINT "generated_legal_contracts_generated_by_user_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;