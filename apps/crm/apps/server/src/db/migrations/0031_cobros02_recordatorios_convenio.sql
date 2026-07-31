-- 0031: COBROS-02 — idempotencia de los recordatorios de CONVENIO D-5/D-3/D-1/D-0.
-- Espejo exacto del schema drizzle `src/db/schema/recordatorios-convenio.ts`.
-- Hermano de recordatorios_premora, pero para créditos EN_CONVENIO (el funnel
-- premora no los toca). Idempotente: seguro de re-correr. La corre el usuario.

DO $$ BEGIN
  CREATE TYPE public.recordatorio_convenio_tipo AS ENUM ('convenio_5','convenio_3','convenio_1','convenio_0');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.recordatorios_convenio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuota_id integer NOT NULL,          -- cuota_convenio_id de cartera-back
  credito_id integer NOT NULL,
  numero_credito_sifco text NOT NULL,
  tipo public.recordatorio_convenio_tipo NOT NULL,
  telefono text,
  fecha_vencimiento text,
  enviado_at timestamp NOT NULL DEFAULT now()
);

-- UNIQUE (cuota, tipo) = "máximo un recordatorio de cada tipo por cuota del
-- convenio"; el job lo usa como claim ANTES de enviar el WhatsApp.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recordatorios_convenio_cuota_tipo
  ON public.recordatorios_convenio (cuota_id, tipo);
CREATE INDEX IF NOT EXISTS idx_recordatorios_convenio_sifco
  ON public.recordatorios_convenio (numero_credito_sifco);
CREATE INDEX IF NOT EXISTS idx_recordatorios_convenio_enviado
  ON public.recordatorios_convenio (enviado_at);
