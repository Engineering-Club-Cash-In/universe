-- Motivo de la última reemisión de un contrato.
--
-- "Regenerar" crea un documento NUEVO en WeeTrust con el mismo PDF, y eso
-- invalida los enlaces que la gente ya tenía. Es una acción con consecuencias
-- para el cliente, así que queda registrado por qué se hizo y cuándo.

ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "last_regeneration_reason" text;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "last_regenerated_at" timestamp;
