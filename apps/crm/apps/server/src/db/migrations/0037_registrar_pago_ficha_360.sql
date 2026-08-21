-- CB-128: registrar pago desde la Ficha 360 (igual a carteraFront).
--
-- Escrita a mano en vez de con `drizzle-kit generate`: el generador
-- interactivo detectó drift preexistente en `leads` (middle_name/
-- loan_purpose) ajeno a este cambio y el meta/_journal.json local ya está
-- desincronizado del historial de archivos .sql (llega a idx 15 / 0028
-- mientras hay archivos hasta 0036) — generar automáticamente hubiera
-- mezclado ambos problemas en una sola migración. Este archivo contiene
-- ÚNICAMENTE los cambios de schema de este trabajo.
--
-- NO ejecutar automáticamente: el usuario la revisa y la corre él mismo.

-- "pago" no es un canal de contacto real — marca la fila que crea el asesor
-- al registrar un pago desde la Ficha 360, donde metodo_contacto es NOT NULL
-- pero no hay canal que reportar. ADD VALUE es aditivo, sin lock exclusivo.
ALTER TYPE public.metodo_contacto ADD VALUE IF NOT EXISTS 'pago';

-- Resultado de la gestión que el propio endpoint de registro de pago crea
-- automáticamente en contactos_cobros (ver pago_reference_id abajo).
ALTER TYPE public.estado_contacto ADD VALUE IF NOT EXISTS 'pago_registrado';

-- Enlaza la gestión con el detalle financiero del pago en pago_references
-- (schema cartera-back.ts). Sin FK a propósito: cartera-back.ts importa de
-- cobros.ts y no al revés, una referencia formal crearía un ciclo de import
-- en Drizzle. Solo se llena cuando estado_contacto = 'pago_registrado'.
ALTER TABLE public.contactos_cobros
  ADD COLUMN IF NOT EXISTS pago_reference_id uuid;
