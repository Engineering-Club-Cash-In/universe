-- El resultado que faltaba para los envíos salientes registrados en
-- automático (WhatsApp/Email/SMS por API desde el modal de contacto).
--
-- "contactado" mentiría (un mensaje de una vía no prueba respuesta, y
-- contaría como respondida la gestión B1); "no_contesta" también miente
-- (nadie dejó de contestar una llamada). Este valor dice lo que pasó:
-- se envió un mensaje, y todavía no hay respuesta.
--
-- ADD VALUE es la dirección segura del enum (no bloquea, no reescribe la
-- tabla) — ver la nota CB-025 en schema/cobros.ts.

ALTER TYPE public.estado_contacto ADD VALUE IF NOT EXISTS 'mensaje_enviado';
