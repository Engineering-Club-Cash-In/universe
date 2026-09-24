CREATE TABLE IF NOT EXISTS "public"."buro_interno_autorizaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL REFERENCES "public"."opportunities"("id") ON DELETE CASCADE,
	"persona_id" uuid NOT NULL REFERENCES "public"."buro_interno_personas"("id") ON DELETE CASCADE,
	"lead_id" uuid REFERENCES "public"."leads"("id") ON DELETE CASCADE,
	"dpi" text,
	"motivo" text NOT NULL,
	"autorizado_por" text NOT NULL REFERENCES "public"."user"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "buro_interno_autorizaciones_uq" ON "public"."buro_interno_autorizaciones" USING btree ("opportunity_id","persona_id");
