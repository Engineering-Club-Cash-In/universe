ALTER SEQUENCE "public"."nexa_token_identifier_seq" INCREMENT BY 1 MINVALUE 100000000 MAXVALUE 999999999 START WITH 100000000 CACHE 1;--> statement-breakpoint
CREATE TABLE "mock_cartera_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"credito_id" integer NOT NULL,
	"borrower_name" varchar(160) DEFAULT 'Cliente prueba' NOT NULL,
	"installment_amount" numeric(18, 2) NOT NULL,
	"initial_balance" numeric(18, 2) NOT NULL,
	"current_balance" numeric(18, 2) NOT NULL,
	"total_paid" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_cartera_credits_credito_id_unique" UNIQUE("credito_id")
);
