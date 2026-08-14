-- 0033: Bot de cobros — el OTP también puede ir a un codeudor.
-- Espejo exacto del schema drizzle `src/db/schema/otp.ts`. Idempotente: seguro
-- de re-correr. La corre el usuario (dev y luego prod), a mano — mismo criterio
-- que 0026..0032.
--
-- Contexto: docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
-- El servicio 1 del bot busca el DPI en `leads` Y en `co_debtors` (D-20). Cuando
-- el match es un codeudor, el código se le manda a él, así que la fila de `otps`
-- tiene que poder apuntar a un codeudor en lugar de a un lead.

-- 1. Referencia opcional al codeudor al que se le envió el código.
ALTER TABLE public.otps
  ADD COLUMN IF NOT EXISTS co_debtor_id uuid REFERENCES public.co_debtors(id) ON DELETE CASCADE;

-- 2. lead_id deja de ser obligatorio: un OTP de codeudor no tiene lead.
ALTER TABLE public.otps
  ALTER COLUMN lead_id DROP NOT NULL;

-- 3. Siempre tiene que haber un destinatario: lead O codeudor.
--    (Se agrega sin validar las filas viejas: todas tienen lead_id, pero si
--    alguna quedó rara la migración no debe caerse.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'otps_destinatario_check'
  ) THEN
    ALTER TABLE public.otps
      ADD CONSTRAINT otps_destinatario_check
      CHECK (lead_id IS NOT NULL OR co_debtor_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- 4. Búsqueda del OTP vigente por DPI (la que hace validar-otp).
CREATE INDEX IF NOT EXISTS idx_otps_dpi_created_at
  ON public.otps (dpi, created_at DESC);
