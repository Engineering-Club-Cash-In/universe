-- Firmantes de contratos legales, con su rol y su link.
--
-- Hasta ahora los links se guardaban por posición en `generated_legal_contracts`
-- (client / representative / additional) asumiendo que el orden era siempre
-- titular → representante legal → resto. No lo es: hay templates donde el
-- representante firma primero, y en cuanto había un cofirmante el link que la
-- ficha mostraba como "Rep. Legal" era en realidad el del cofirmante.
--
-- Las columnas viejas se dejan: son el único registro de los contratos que ya
-- están firmándose. Las nuevas se llenan de aquí en adelante.

CREATE TYPE "public"."contract_signatory_status" AS ENUM('pending', 'signed', 'declined');
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "signing_provider" text;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "weetrust_document_id" text;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "signature_mode" text DEFAULT 'electronica' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."contract_signatories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"role" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"weetrust_signatory_id" text,
	"signing_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "public"."contract_signatory_status" DEFAULT 'pending' NOT NULL,
	"signed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contract_signatories_role_valid" CHECK ("role" IN ('TITULAR', 'COFIRMANTE', 'REP_LEGAL', 'VENDEDOR'))
);
--> statement-breakpoint
ALTER TABLE "public"."contract_signatories" ADD CONSTRAINT "contract_signatories_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."generated_legal_contracts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_signatories_contract_idx" ON "public"."contract_signatories" USING btree ("contract_id");
--> statement-breakpoint
-- WeeTrust manda un solo link por correo aunque la persona firme en varias
-- líneas del mismo documento.
CREATE UNIQUE INDEX IF NOT EXISTS "contract_signatories_contract_email_unique" ON "public"."contract_signatories" USING btree ("contract_id", "email");
--> statement-breakpoint
-- La declaración de vendedor se firma en papel; marcarla evita que los
-- contratos ya generados sigan pareciendo pendientes de un link que no existe.
UPDATE "public"."generated_legal_contracts"
SET "signature_mode" = 'fisica'
WHERE "contract_type" = 'declaracion_vendedor';
