CREATE TABLE "lead_intake_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_form_key" text NOT NULL,
	"field_key" text NOT NULL,
	"field_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "lead_intake_answers" ADD CONSTRAINT "lead_intake_answers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_intake_answers_lead_form_field_unique" ON "lead_intake_answers" USING btree ("lead_id","campaign_form_key","field_key");
