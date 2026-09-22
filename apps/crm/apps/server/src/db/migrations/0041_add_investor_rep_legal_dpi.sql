-- DPI del representante legal del inversionista, cuando es una sociedad.
--
-- Quien firma los contratos de una sociedad no es "la empresa" sino su
-- representante, y el catálogo de campos del contrato se pide por DPI. En
-- cartera es `inversionistas.dpi_rep_legal`, y viaja en la foto que deja la
-- compra aceptada.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

ALTER TABLE "public"."investor_contract_batches" ADD COLUMN IF NOT EXISTS "investor_dpi_rep_legal" text;
