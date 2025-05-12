CREATE TABLE "openai_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "openai_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer,
	"thread_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "st_credit_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "st_credit_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer,
	"first_statement_url" text NOT NULL,
	"second_statement_url" text NOT NULL,
	"third_statement_url" text NOT NULL,
	"min_payment" real,
	"max_payment" real,
	"max_adjusted_payment" real,
	"maximum_credit" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "st_credit_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "st_credit_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lead_id" integer,
	"fit" boolean NOT NULL,
	"probability" real NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "st_leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "st_leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"crm_id" text NOT NULL,
	"phone" text NOT NULL,
	"age" integer,
	"civil_status" text,
	"economic_dependents" integer,
	"monthly_income" integer,
	"financing_amount" integer,
	"occupation" text,
	"work_time" text,
	"money_usage" text,
	"has_own_house" boolean,
	"has_own_vehicle" boolean,
	"has_credit_card" boolean,
	"name" text,
	"document_number" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "openai_runs" ADD CONSTRAINT "openai_runs_lead_id_st_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."st_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "st_credit_profiles" ADD CONSTRAINT "st_credit_profiles_lead_id_st_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."st_leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "st_credit_scores" ADD CONSTRAINT "st_credit_scores_lead_id_st_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."st_leads"("id") ON DELETE no action ON UPDATE no action;