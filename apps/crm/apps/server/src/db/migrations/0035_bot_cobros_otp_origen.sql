-- 0035: Bot de cobros — separar los OTP de cobros de los de ventas.
-- Espejo exacto del schema drizzle `src/db/schema/otp.ts`. Idempotente: seguro
-- de re-correr. La corre el usuario (dev y luego prod), a mano — mismo criterio
-- que 0026..0034.
--
-- Contexto: docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
--
-- La tabla `otps` la comparten el bot de ventas y el de cobros. Como la
-- validación del bot de cobros buscaba la fila SOLO por su id, se podía entrar
-- con un código emitido por el flujo de ventas:
--
--   1. `/info/send-otp` es PÚBLICO, recibe el DPI de la víctima y un teléfono
--      elegido por quien llama, y devuelve el `otpId`.
--   2. Con ese id y el código que llegó al teléfono del atacante, el servicio 2
--      del bot daba por validada a la víctima y listaba sus créditos.
--
-- Con `origen` la validación de cobros solo acepta los códigos que emitió el
-- propio bot de cobros. Las filas viejas quedan como 'ventas', que es lo que
-- son.

ALTER TABLE public.otps
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'ventas';

-- Búsqueda de los códigos vigentes de una identidad (control de reenvíos).
CREATE INDEX IF NOT EXISTS idx_otps_origen_lead_created
  ON public.otps (origen, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_otps_origen_codeudor_created
  ON public.otps (origen, co_debtor_id, created_at DESC);
