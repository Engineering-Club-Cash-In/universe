CREATE TABLE "client_leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "client_leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ready" boolean NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"loan_type" text NOT NULL,
	"car_loan_info_action" text,
	"has_statements" boolean,
	"vehicle_loan_info_action" text,
	"vehicle_details" text,
	"loan_amount" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investor_leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "investor_leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"full_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text NOT NULL,
	"has_invested" boolean NOT NULL,
	"has_bank_account" boolean NOT NULL,
	"investment_range" text NOT NULL,
	"contact_method" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
