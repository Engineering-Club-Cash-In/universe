-- La cotización con la que se cerró el crédito no se puede borrar mientras esté
-- registrada como la del cierre: el correo de la factura a la aseguradora la usa.
-- Antes era ON DELETE CASCADE y borrar la cotización borraba también el registro.
--
-- Idempotente. Correr en una sola transacción para no quedar sin la llave.

ALTER TABLE "public"."opportunity_close_quotations" DROP CONSTRAINT IF EXISTS "opportunity_close_quotations_quotation_id_quotations_id_fk";--> statement-breakpoint
ALTER TABLE "public"."opportunity_close_quotations" ADD CONSTRAINT "opportunity_close_quotations_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;
