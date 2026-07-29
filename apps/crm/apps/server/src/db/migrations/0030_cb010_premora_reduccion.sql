-- 0030: CB-010 — Reducción de recordatorios premora a clientes que pagan bien.
-- Espejo exacto del schema drizzle `src/db/schema/premora-reduccion.ts`.
-- Idempotente: seguro de re-correr. La corre el usuario (dev y luego prod).

-- 1. Foto del comportamiento de pago por crédito (refrescada por job diario).
CREATE TABLE IF NOT EXISTS public.premora_pago_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_credito_sifco text NOT NULL,
  credito_id integer,
  cliente text,
  cuota_mensual text,
  proxima_fecha_pago text,
  cuotas_al_dia_consecutivas integer NOT NULL DEFAULT 0,
  ultima_cuota_evaluada integer,
  total_vencidas integer,
  elegible boolean NOT NULL DEFAULT false,
  calculado_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Columnas cacheadas del crédito (nombre de cartera, cuota mensual, próximo
-- pago). Como ALTER ADD COLUMN IF NOT EXISTS para que esta migración también
-- actualice una tabla ya creada por una versión previa de este mismo archivo.
ALTER TABLE public.premora_pago_tracking ADD COLUMN IF NOT EXISTS cliente text;
ALTER TABLE public.premora_pago_tracking ADD COLUMN IF NOT EXISTS cuota_mensual text;
ALTER TABLE public.premora_pago_tracking ADD COLUMN IF NOT EXISTS proxima_fecha_pago text;

-- Un crédito = una fila (el job hace upsert por SIFCO).
CREATE UNIQUE INDEX IF NOT EXISTS uq_premora_pago_tracking_sifco
  ON public.premora_pago_tracking (numero_credito_sifco);
CREATE INDEX IF NOT EXISTS idx_premora_pago_tracking_elegible
  ON public.premora_pago_tracking (elegible);

-- 2. Reducción que el Gerente aplicó a un crédito (pasos del embudo quitados).
CREATE TABLE IF NOT EXISTS public.premora_reduccion_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_credito_sifco text NOT NULL,
  pasos_removidos integer[] NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  configurado_por text NOT NULL REFERENCES public."user"(id),
  configurado_at timestamp NOT NULL DEFAULT now(),
  origen text NOT NULL DEFAULT 'manual',
  revocado_at timestamp,
  revocado_motivo text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Un crédito = una config (upsert; al revocar se apaga `activo`, no se borra).
CREATE UNIQUE INDEX IF NOT EXISTS uq_premora_reduccion_config_sifco
  ON public.premora_reduccion_config (numero_credito_sifco);
CREATE INDEX IF NOT EXISTS idx_premora_reduccion_config_activo
  ON public.premora_reduccion_config (activo);
