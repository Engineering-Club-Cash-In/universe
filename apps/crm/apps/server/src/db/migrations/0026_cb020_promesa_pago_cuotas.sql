-- 0026: CB-020 — Promesa de Pago atada a rango de cuotas + mora del crédito.
-- Espejo exacto del schema drizzle `src/db/schema/cobros.ts` (contactosCobros).
-- Idempotente: seguro de re-correr. Aplicar A MANO (no drizzle-kit push/migrate
-- corrido desde este trabajo — mismo criterio que 0025_create_recordatorios_premora.sql).
--
-- Diseño acordado con Daniel Rodríguez: cartera-back NO separa la mora por
-- cuota (moras_credito es un monto AGREGADO del crédito completo, no por
-- cuota individual) — por eso incluye_mora es independiente de cuota_inicio/
-- cuota_fin: puede haber rango sin mora, mora sin rango ("solo mora", caso
-- confirmado por Daniel), o ambos.
--
-- estado_promesa: solo aplica a filas con estado_contacto = 'promesa_pago'.
-- Se deriva verificando cuota_inicio..cuota_fin (pagado=true en cartera-back)
-- y/o la mora activa del crédito (moras_credito.activa) — nunca se marca a
-- mano; ver getEstadoPromesasPago en routers/cobros.ts.

DO $$ BEGIN
  CREATE TYPE public.estado_promesa AS ENUM ('pendiente', 'cumplida', 'incumplida');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS cuota_inicio integer;

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS cuota_fin integer;

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS incluye_mora boolean NOT NULL DEFAULT false;

ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS estado_promesa public.estado_promesa;

-- CHECK de rango (review): la validación de "cuota_inicio > 0, cuota_fin >=
-- cuota_inicio" solo vivía en Zod (app layer) — un INSERT/UPDATE por SQL
-- directo o un bug futuro en el código podía dejar un rango invertido o
-- negativo sin que la DB lo impida. NULL en cualquiera de las dos (o ambas,
-- "solo mora" sin rango) sigue permitido — el CHECK solo exige coherencia
-- cuando el rango SÍ está presente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contactos_cobros_cuota_rango_check'
  ) THEN
    ALTER TABLE public.contactos_cobros
      ADD CONSTRAINT contactos_cobros_cuota_rango_check
      CHECK (
        cuota_inicio IS NULL
        OR cuota_fin IS NULL
        OR (cuota_inicio > 0 AND cuota_fin >= cuota_inicio)
      );
  END IF;
END $$;
