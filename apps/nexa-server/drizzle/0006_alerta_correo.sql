ALTER TABLE "nexa_payment_transactions" ADD COLUMN "alerta_correo_enviada_at" timestamp with time zone;--> statement-breakpoint
-- Los casos que ya existen se dan por avisados: el primer correo trae solo los nuevos.
-- Misma condición que manualReviewAlertCondition (staleBefore = 300 s del scanner).
UPDATE "nexa_payment_transactions"
SET "alerta_correo_enviada_at" = now()
WHERE "alerta_correo_enviada_at" IS NULL AND (
  "failure_reason" = 'billing_reconciliation_required'
  OR ("token_date" = '' AND "updated_at" <= now() - interval '300 seconds')
  OR ("processing_status" = 'MANUAL_REVIEW' AND ("failure_reason" IS NULL OR "failure_reason" <> 'missing_token_date'))
);
