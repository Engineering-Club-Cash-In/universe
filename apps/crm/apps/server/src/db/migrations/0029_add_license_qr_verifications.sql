CREATE TYPE "public"."license_verification_result" AS ENUM('valida', 'invalida', 'ilegible', 'revision_manual');--> statement-breakpoint
CREATE TABLE "public"."license_qr_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"co_debtor_id" uuid,
	"opportunity_id" uuid,
	"document_key" text,
	"qr_raw_url" text,
	"qr_domain_valid" boolean DEFAULT false NOT NULL,
	"card_code" text,
	"api_response_code" integer,
	"license_holder_name" text,
	"license_number" text,
	"license_expires_at" text,
	"raw_response" jsonb,
	"identity_match_score" numeric(5, 2),
	"result" "public"."license_verification_result" NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "license_qr_verifications_lead_xor_co_debtor" CHECK (num_nonnulls("lead_id", "co_debtor_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "public"."license_qr_verifications" ADD CONSTRAINT "license_qr_verifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."license_qr_verifications" ADD CONSTRAINT "license_qr_verifications_co_debtor_id_co_debtors_id_fk" FOREIGN KEY ("co_debtor_id") REFERENCES "public"."co_debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."license_qr_verifications" ADD CONSTRAINT "license_qr_verifications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."license_qr_verifications" ADD CONSTRAINT "license_qr_verifications_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "license_qr_verifications_lead_id_idx" ON "public"."license_qr_verifications" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "license_qr_verifications_co_debtor_id_idx" ON "public"."license_qr_verifications" USING btree ("co_debtor_id");--> statement-breakpoint
CREATE INDEX "license_qr_verifications_opportunity_id_idx" ON "public"."license_qr_verifications" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "license_qr_verifications_created_at_idx" ON "public"."license_qr_verifications" USING btree ("created_at");
