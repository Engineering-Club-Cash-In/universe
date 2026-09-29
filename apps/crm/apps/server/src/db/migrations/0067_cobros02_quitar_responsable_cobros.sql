-- COBROS-02 · La asignación asesor ↔ crédito vive en CARTERA, no en el CRM (2/2).
--
-- ⚠️ Correr SOLO DESPUÉS de desplegar el código que ya no usa estas columnas
-- (el PR que agrega lib/acceso-caso-cobro.ts). Un servidor con el código
-- anterior las sigue leyendo y se cae con "column does not exist".
--
-- Borra las dos columnas de asignación del CRM, que ya nadie lee:
--   · casos_cobros.responsable_cobros       — ver 0066.
--   · contratos_financiamiento.responsable_cobros — nunca se usó.
-- Con la columna se van sus FK a "user".
--
-- Idempotente.

ALTER TABLE "casos_cobros" DROP COLUMN IF EXISTS "responsable_cobros";
--> statement-breakpoint
ALTER TABLE "contratos_financiamiento" DROP COLUMN IF EXISTS "responsable_cobros";
