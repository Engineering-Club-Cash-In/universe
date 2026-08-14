-- 0034: Bot de cobros — el OTP ya no depende del DPI.
-- Espejo exacto del schema drizzle `src/db/schema/otp.ts`. Idempotente: seguro
-- de re-correr. La corre el usuario (dev y luego prod), a mano — mismo criterio
-- que 0026..0033.
--
-- Contexto: docs/features/bot-whatsapp-cobros/01-identificacion-y-acceso.md
--
-- Dos motivos:
--   1. 274 de los 1,522 clientes con crédito (18%) NO tienen DPI en el lead. Si
--      se identifican por placa o por NIT, con `dpi NOT NULL` no se les puede
--      generar un código y quedan fuera del bot.
--   2. El bot ya no busca el OTP por DPI: el servicio 1 devuelve una referencia
--      opaca (el id de la fila) y el servicio 2 valida con ella, así el código
--      solo sirve para esa persona.

ALTER TABLE public.otps
  ALTER COLUMN dpi DROP NOT NULL;
