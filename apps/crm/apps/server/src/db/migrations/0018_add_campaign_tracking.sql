ALTER TYPE "public"."lead_source" ADD VALUE IF NOT EXISTS 'meta';--> statement-breakpoint
ALTER TYPE "public"."investment_lead_source" ADD VALUE IF NOT EXISTS 'other';--> statement-breakpoint
ALTER TYPE "public"."investment_lead_source" ADD VALUE IF NOT EXISTS 'facebook';--> statement-breakpoint
ALTER TYPE "public"."investment_lead_source" ADD VALUE IF NOT EXISTS 'instagram';--> statement-breakpoint
ALTER TYPE "public"."investment_lead_source" ADD VALUE IF NOT EXISTS 'google';--> statement-breakpoint
ALTER TYPE "public"."investment_lead_source" ADD VALUE IF NOT EXISTS 'meta';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "campaign" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "campaign" text;--> statement-breakpoint
ALTER TABLE "investment_leads" ADD COLUMN IF NOT EXISTS "campaign" text;
