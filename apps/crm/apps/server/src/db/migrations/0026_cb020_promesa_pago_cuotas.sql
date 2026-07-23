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

-- CHECK de rango (review Codex, ronda 2): la primera versión de este CHECK
-- solo exigía coherencia CUANDO ambos bounds estaban presentes (OR cuota_fin
-- IS NULL escapaba el chequeo) — dejaba pasar cuota_inicio=5, cuota_fin=NULL
-- (bound parcial). Mismo hueco que ya se cerró en Zod (createContactoCobros,
-- .refine "ambos o ninguno"): con el rango a medias, evaluarPromesa trata
-- cuota_fin=NULL como "sin rango, no bloquea" — la cuota que el usuario SÍ
-- especificó nunca se verifica. AMBOS bounds o NINGUNO, siempre — sin escape
-- por un solo NULL. NULL/NULL ("solo mora" o el caso vacío del web viejo,
-- previo al PR de web) sigue permitido.
--
-- Diagnóstico previo (review Codex, ronda 3): si YA existen filas con bound
-- parcial (por SQL directo previo, u otro origen no controlado por Zod), el
-- ADD CONSTRAINT de abajo revienta con el error genérico de Postgres
-- ("violates check constraint") sin decir CUÁLES filas — quien aplique esto
-- a mano queda a ciegas. Verificado en dev al escribir esta migración: 0
-- filas afectadas — pero el ambiente donde se corra puede diferir. Este
-- bloque falla ANTES, con mensaje explícito y los ids a corregir.
DO $$
DECLARE
  filas_afectadas text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO filas_afectadas
  FROM public.contactos_cobros
  WHERE (cuota_inicio IS NULL) IS DISTINCT FROM (cuota_fin IS NULL);

  IF filas_afectadas IS NOT NULL THEN
    RAISE EXCEPTION 'contactos_cobros tiene filas con cuota_inicio/cuota_fin parcial (una NULL, la otra no) — el CHECK de abajo las rechazaría. Corregir a mano antes de aplicar esta migración. ids: %', filas_afectadas;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contactos_cobros_cuota_rango_check'
  ) THEN
    ALTER TABLE public.contactos_cobros
      ADD CONSTRAINT contactos_cobros_cuota_rango_check
      CHECK (
        (cuota_inicio IS NULL AND cuota_fin IS NULL)
        OR (
          cuota_inicio IS NOT NULL
          AND cuota_fin IS NOT NULL
          AND cuota_inicio > 0
          AND cuota_fin >= cuota_inicio
        )
      );
  END IF;
END $$;
