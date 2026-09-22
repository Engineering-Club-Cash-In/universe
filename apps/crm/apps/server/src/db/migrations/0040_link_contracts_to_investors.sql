-- Un contrato puede ser de un lead (ventas) o de un inversionista (inversiones).
--
-- `lead_id` era obligatorio porque todos los contratos salían de una
-- oportunidad de venta. Los de inversiones no tienen lead: su dueño es el
-- inversionista, que vive en cartera (otra base, por eso no hay FK), y salen de
-- la batería que abre cada compra aceptada.
--
-- Se exige que venga uno de los dos: una fila sin dueño no se puede mostrar en
-- ninguna ficha y no se sabría de quién es.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

ALTER TABLE "public"."generated_legal_contracts" ALTER COLUMN "lead_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "investor_id" integer;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "batch_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "public"."generated_legal_contracts"
    ADD CONSTRAINT "generated_legal_contracts_batch_id_fk"
    FOREIGN KEY ("batch_id") REFERENCES "public"."investor_contract_batches"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "public"."generated_legal_contracts"
    ADD CONSTRAINT "generated_legal_contracts_dueno_check"
    CHECK ("lead_id" IS NOT NULL OR "investor_id" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "generated_legal_contracts_investor_idx" ON "public"."generated_legal_contracts" ("investor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_legal_contracts_batch_idx" ON "public"."generated_legal_contracts" ("batch_id");
