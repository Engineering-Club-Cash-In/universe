CREATE TYPE "public"."validation_tipo" AS ENUM('renap', 'buro');--> statement-breakpoint
CREATE TYPE "public"."validation_estado" AS ENUM('aprobado', 'rechazado', 'error', 'sin_registro');--> statement-breakpoint
CREATE TABLE "public"."opportunity_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"dpi" text NOT NULL,
	"tipo" "public"."validation_tipo" NOT NULL,
	"estado" "public"."validation_estado" NOT NULL,
	"mensaje" text,
	"score_riesgo" integer,
	"nivel_riesgo" text,
	"alertas" text[],
	"fuente_de_datos" text,
	"expira_en" timestamp,
	"ejecutado_por" text,
	"ejecutado_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ADD CONSTRAINT "opportunity_validations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."opportunity_validations" ADD CONSTRAINT "opportunity_validations_ejecutado_por_user_id_fk" FOREIGN KEY ("ejecutado_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_validations_opportunity_id_idx" ON "public"."opportunity_validations" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_validations_lookup_idx" ON "public"."opportunity_validations" USING btree ("opportunity_id","tipo","ejecutado_at" DESC);
