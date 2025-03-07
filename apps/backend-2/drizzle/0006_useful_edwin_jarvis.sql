CREATE TABLE "credit_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"credit_record_id" integer,
	"fit" boolean,
	"probability" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_credit_record_id_credit_records_id_fk" FOREIGN KEY ("credit_record_id") REFERENCES "public"."credit_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_record_results" DROP COLUMN "missing_payments";