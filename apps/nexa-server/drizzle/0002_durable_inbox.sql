ALTER TABLE "nexa_payment_transactions" ALTER COLUMN "processing_status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."nexa_processing_status" RENAME TO "nexa_processing_status_legacy";--> statement-breakpoint
CREATE TYPE "public"."nexa_processing_status" AS ENUM('PENDING', 'RECEIVED', 'APPLYING', 'APPLIED', 'REVIEW_PENDING', 'COMPLETED', 'REJECTED', 'FAILED', 'MANUAL_REVIEW');--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ALTER COLUMN "processing_status" TYPE "public"."nexa_processing_status" USING "processing_status"::text::"public"."nexa_processing_status";--> statement-breakpoint
DROP TYPE "public"."nexa_processing_status_legacy";--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ALTER COLUMN "processing_status" SET DEFAULT 'RECEIVED';--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "payload_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "review_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "nexa_payment_transactions" ADD COLUMN "review_next_attempt_at" timestamp with time zone;
