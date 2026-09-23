-- Anulación de contratos reemplazados.
--
-- Un documento ya firmado NO se puede borrar en WeeTrust: queda registrado en su
-- blockchain y la API no tiene ningún endpoint para anularlo ("una vez que un
-- documento se encuentre como completado no será posible eliminarlo"). Lo único
-- posible es dejarlo sin efecto de este lado, y para que eso sirva de algo tiene
-- que quedar dicho POR QUÉ y CUÁL lo reemplazó.
--
-- Los pendientes sí se borran en WeeTrust, así que esos no dejan fila anulada.

ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "replaced_by_contract_id" uuid;
