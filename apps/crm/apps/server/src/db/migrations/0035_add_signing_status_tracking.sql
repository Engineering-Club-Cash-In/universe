-- Seguimiento del estado de firma sin tener que preguntarle a WeeTrust en cada
-- carga de pantalla.
--
-- `signing_url_expiry` guarda el vencimiento del link de cada persona (WeeTrust
-- lo devuelve como epoch en milisegundos), para poder avisar "link vencido" en
-- la ficha. `signing_status_checked_at` deja constancia de cuándo se consultó
-- por última vez, así se sabe si lo que se ve es de hace un minuto o de hace
-- tres días.

ALTER TABLE "public"."contract_signatories" ADD COLUMN IF NOT EXISTS "signing_url_expiry" timestamp;
--> statement-breakpoint
ALTER TABLE "public"."generated_legal_contracts" ADD COLUMN IF NOT EXISTS "signing_status_checked_at" timestamp;
