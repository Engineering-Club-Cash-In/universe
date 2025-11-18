CREATE TABLE "credit_record_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_record_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"credit_record_id" integer,
	"min_payment" real,
	"max_payment" real,
	"max_adjusted_payment" real,
	"maximum_credit" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "credit_record_results" ADD CONSTRAINT "credit_record_results_credit_record_id_credit_records_id_fk" FOREIGN KEY ("credit_record_id") REFERENCES "public"."credit_records"("id") ON DELETE no action ON UPDATE no action;