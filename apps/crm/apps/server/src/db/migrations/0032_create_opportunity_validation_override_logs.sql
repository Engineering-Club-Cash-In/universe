CREATE TABLE "public"."opportunity_validation_overrides_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"validation_id" uuid NOT NULL,
	"overridden_validation_id" uuid NOT NULL,
	"tipo" "public"."validation_tipo" NOT NULL,
	"reason" text,
	"marked_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_validation_overrides_logs_validation_id_unique" UNIQUE("validation_id")
);
--> statement-breakpoint
ALTER TABLE "public"."opportunity_validation_overrides_logs" ADD CONSTRAINT "opportunity_validation_overrides_logs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validation_overrides_logs" ADD CONSTRAINT "opportunity_validation_overrides_logs_validation_id_opportunity_validations_id_fk" FOREIGN KEY ("validation_id") REFERENCES "public"."opportunity_validations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validation_overrides_logs" ADD CONSTRAINT "opportunity_validation_overrides_logs_overridden_validation_id_opportunity_validations_id_fk" FOREIGN KEY ("overridden_validation_id") REFERENCES "public"."opportunity_validations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validation_overrides_logs" ADD CONSTRAINT "opportunity_validation_overrides_logs_marked_by_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_validation_overrides_logs_opportunity_id_idx" ON "public"."opportunity_validation_overrides_logs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_validation_overrides_logs_marked_by_idx" ON "public"."opportunity_validation_overrides_logs" USING btree ("marked_by");--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ALTER COLUMN "ejecutado_at" SET DEFAULT clock_timestamp();
