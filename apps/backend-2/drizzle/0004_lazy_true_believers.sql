ALTER TABLE "credit_records" DROP CONSTRAINT "credit_records_lead_id_unique";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_email_unique";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_phone_unique";