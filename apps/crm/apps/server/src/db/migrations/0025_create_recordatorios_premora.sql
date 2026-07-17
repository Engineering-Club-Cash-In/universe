-- 0025: Premora (CC2-11) — idempotencia de los recordatorios D-5/D-3/D-1/D-0.
-- Espejo exacto del schema drizzle `src/db/schema/recordatorios-premora.ts`.
-- Idempotente: seguro de re-correr. Ya aplicada a mano en DEV (green, schema
-- public); PENDIENTE de aplicar en PROD en el próximo pase.

DO $$ BEGIN
  CREATE TYPE public.recordatorio_premora_tipo AS ENUM ('premora_5','premora_3','premora_1','premora_0');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.recordatorios_premora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuota_id integer NOT NULL,
  credito_id integer NOT NULL,
  numero_credito_sifco text NOT NULL,
  tipo public.recordatorio_premora_tipo NOT NULL,
  telefono text,
  fecha_vencimiento text,
  enviado_at timestamp NOT NULL DEFAULT now()
);

-- UNIQUE (cuota, tipo) = la garantía de "máximo un recordatorio de cada tipo
-- por cuota"; el job lo usa como claim ANTES de enviar el WhatsApp.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recordatorios_premora_cuota_tipo
  ON public.recordatorios_premora (cuota_id, tipo);
CREATE INDEX IF NOT EXISTS idx_recordatorios_premora_sifco
  ON public.recordatorios_premora (numero_credito_sifco);
CREATE INDEX IF NOT EXISTS idx_recordatorios_premora_enviado
  ON public.recordatorios_premora (enviado_at);
