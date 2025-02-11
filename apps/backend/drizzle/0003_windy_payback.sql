ALTER TABLE "credit_records" ADD CONSTRAINT "credit_records_lead_id_unique" UNIQUE("lead_id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_phone_unique" UNIQUE("phone");