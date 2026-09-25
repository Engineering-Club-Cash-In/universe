-- Lo que el inversionista tenía aportado en cartera ANTES de la compra que
-- abrió (o reusó) la batería.
--
-- Decide qué verificación de identidad se le pide al firmar sus contratos: en
-- cero es su primera compra y firma con selfie y DPI; con monto, sólo firma
-- (ver `lib/identidad-inversionista.ts`). Lo calcula cartera al aceptar la
-- compra y lo manda en el aviso.
--
-- Vacío en las baterías de antes: se tratan como primera compra, que es lo que
-- se pedía hasta ahora.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

ALTER TABLE "public"."investor_contract_batches" ADD COLUMN IF NOT EXISTS "monto_aportado_previo" numeric(18, 2);
