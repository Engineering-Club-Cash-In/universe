CREATE TYPE "public"."crm_audit_entity_type" AS ENUM('lead', 'opportunity', 'vehicle');--> statement-breakpoint
CREATE TYPE "public"."crm_audit_source" AS ENUM('crm', 'bot', 'portal', 'public', 'system');--> statement-breakpoint
CREATE TABLE "public"."crm_entity_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "public"."crm_audit_entity_type" NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"procedure" text,
	"performed_by" text,
	"performed_by_role" text,
	"source" "public"."crm_audit_source" DEFAULT 'crm' NOT NULL,
	"input" jsonb,
	"ok" boolean DEFAULT true NOT NULL,
	"error_code" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "crm_entity_audit_entity_idx" ON "public"."crm_entity_audit" USING btree ("entity_type","entity_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "crm_entity_audit_performed_by_idx" ON "public"."crm_entity_audit" USING btree ("performed_by","created_at" DESC);--> statement-breakpoint
CREATE INDEX "crm_entity_audit_created_at_idx" ON "public"."crm_entity_audit" USING btree ("created_at" DESC);
