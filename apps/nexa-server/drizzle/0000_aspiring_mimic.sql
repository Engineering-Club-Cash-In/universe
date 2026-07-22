CREATE TYPE "public"."nexa_poll_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."nexa_processing_status" AS ENUM('PENDING', 'APPLIED', 'REJECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."nexa_review_status" AS ENUM('APPROVED', 'REJECTED');--> statement-breakpoint
CREATE SEQUENCE "public"."nexa_token_identifier_seq" INCREMENT BY 1 MINVALUE 100000000 MAXVALUE 999999999 START WITH 100000000 CACHE 1;--> statement-breakpoint
CREATE TABLE "nexa_payment_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"nexa_token_id" integer NOT NULL,
	"prefix" varchar(7) NOT NULL,
	"account" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nexa_payment_tokens_nexa_token_id_unique" UNIQUE("nexa_token_id")
);
--> statement-breakpoint
CREATE TABLE "nexa_payment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(80) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"bank" varchar(80) NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"account" varchar(80) NOT NULL,
	"token" varchar(32) NOT NULL,
	"token_date" varchar(80) NOT NULL,
	"token_identifier" varchar(9) NOT NULL,
	"token_name" varchar(200) NOT NULL,
	"token_prefix" varchar(7) NOT NULL,
	"was_return" integer NOT NULL,
	"transaction_id" varchar(120) DEFAULT '' NOT NULL,
	"processing_status" "nexa_processing_status" DEFAULT 'PENDING' NOT NULL,
	"cartera_payment_id" integer,
	"failure_reason" text,
	"raw_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nexa_payment_transactions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "nexa_poll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"status" "nexa_poll_run_status" DEFAULT 'RUNNING' NOT NULL,
	"transactions_found" integer DEFAULT 0 NOT NULL,
	"transactions_created" integer DEFAULT 0 NOT NULL,
	"transactions_applied" integer DEFAULT 0 NOT NULL,
	"transactions_rejected" integer DEFAULT 0 NOT NULL,
	"transactions_skipped" integer DEFAULT 0 NOT NULL,
	"transactions_failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nexa_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"reference" varchar(80) NOT NULL,
	"status" "nexa_review_status" NOT NULL,
	"request_payload" jsonb NOT NULL,
	"response_payload" jsonb,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nexa_token_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_token_id" integer NOT NULL,
	"nexa_user_id" integer NOT NULL,
	"credito_id" integer NOT NULL,
	"identifier" varchar(9) NOT NULL,
	"token" varchar(32) NOT NULL,
	"description" varchar(200) NOT NULL,
	"national_id" varchar(20) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nexa_token_users_nexa_user_id_unique" UNIQUE("nexa_user_id"),
	CONSTRAINT "nexa_token_users_credito_id_unique" UNIQUE("credito_id"),
	CONSTRAINT "nexa_token_users_identifier_unique" UNIQUE("identifier"),
	CONSTRAINT "nexa_token_users_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "nexa_reviews" ADD CONSTRAINT "nexa_reviews_transaction_id_nexa_payment_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."nexa_payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nexa_token_users" ADD CONSTRAINT "nexa_token_users_payment_token_id_nexa_payment_tokens_id_fk" FOREIGN KEY ("payment_token_id") REFERENCES "public"."nexa_payment_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nexa_payment_transactions_reference_idx" ON "nexa_payment_transactions" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "nexa_payment_transactions_token_idx" ON "nexa_payment_transactions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "nexa_payment_transactions_status_idx" ON "nexa_payment_transactions" USING btree ("processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "nexa_token_users_token_idx" ON "nexa_token_users" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "nexa_token_users_credito_idx" ON "nexa_token_users" USING btree ("credito_id");
