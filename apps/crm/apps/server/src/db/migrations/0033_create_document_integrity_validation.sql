CREATE TYPE "public"."document_validation_result" AS ENUM('valido', 'observacion', 'revision_manual', 'rechazado', 'error');--> statement-breakpoint
CREATE TYPE "public"."document_validation_source" AS ENUM('documentacion', 'analisis_capacidad');--> statement-breakpoint
CREATE TYPE "public"."document_validation_run_status" AS ENUM('processing', 'completed', 'error');--> statement-breakpoint
CREATE TABLE "public"."document_integrity_validation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "public"."document_validation_run_status" DEFAULT 'processing' NOT NULL,
	"validation_source" "public"."document_validation_source" NOT NULL,
	"requested_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "public"."document_integrity_validation_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"reset_after_attempt_number" integer NOT NULL,
	"reset_by" text NOT NULL,
	"reset_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public"."document_integrity_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"validation_run_id" uuid NOT NULL,
	"opportunity_document_id" uuid,
	"document_type" "public"."document_type" NOT NULL,
	"document_file_path" text NOT NULL,
	"content_sha256" text NOT NULL,
	"auto_result" "public"."document_validation_result" NOT NULL,
	"auto_score" integer DEFAULT 0 NOT NULL,
	"auto_reason" text NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technical_fingerprint" jsonb,
	"ai_raw_response" jsonb,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "public"."document_integrity_validation_runs" ADD CONSTRAINT "doc_integrity_run_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."document_integrity_validation_runs" ADD CONSTRAINT "doc_integrity_run_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."document_integrity_validation_resets" ADD CONSTRAINT "doc_integrity_reset_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."document_integrity_validation_resets" ADD CONSTRAINT "doc_integrity_reset_by_fk" FOREIGN KEY ("reset_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."document_integrity_validations" ADD CONSTRAINT "doc_integrity_val_run_id_fk" FOREIGN KEY ("validation_run_id") REFERENCES "public"."document_integrity_validation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."document_integrity_validations" ADD CONSTRAINT "doc_integrity_val_opp_doc_id_fk" FOREIGN KEY ("opportunity_document_id") REFERENCES "public"."opportunity_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_integrity_run_opp_attempt_unique" ON "public"."document_integrity_validation_runs" USING btree ("opportunity_id", "attempt_number");--> statement-breakpoint
CREATE INDEX "doc_integrity_run_opportunity_idx" ON "public"."document_integrity_validation_runs" USING btree ("opportunity_id", "started_at" DESC);--> statement-breakpoint
CREATE INDEX "doc_integrity_reset_opportunity_idx" ON "public"."document_integrity_validation_resets" USING btree ("opportunity_id", "reset_after_attempt_number" DESC);--> statement-breakpoint
CREATE INDEX "doc_integrity_val_run_idx" ON "public"."document_integrity_validations" USING btree ("validation_run_id");--> statement-breakpoint
CREATE INDEX "doc_integrity_val_opp_doc_idx" ON "public"."document_integrity_validations" USING btree ("opportunity_document_id");--> statement-breakpoint
CREATE INDEX "doc_integrity_val_result_idx" ON "public"."document_integrity_validations" USING btree ("auto_result");--> statement-breakpoint
CREATE INDEX "doc_integrity_val_sha_idx" ON "public"."document_integrity_validations" USING btree ("content_sha256");--> statement-breakpoint
CREATE INDEX "doc_integrity_val_identifier_normalized_idx" ON "public"."document_integrity_validations" USING btree (upper(regexp_replace(coalesce("ai_raw_response"->>'identificador_detectado', ''), '[^A-Za-z0-9]', '', 'g')));--> statement-breakpoint
CREATE INDEX "doc_integrity_val_signals_gin_idx" ON "public"."document_integrity_validations" USING gin ("signals" jsonb_path_ops);
