-- 🔴 ORDEN DE DESPLIEGUE — esta migración va a producción ANTES que el código.
-- drizzle pide estas columnas en cada SELECT/UPDATE de `nexa_payment_events`;
-- si el código sale primero, los pagos de Nexa fallan con
-- "column ... does not exist".
--
-- Estado del recibo por WhatsApp de cada pago de Nexa
--
-- Cuando un pago de Nexa queda aplicado, cartera le manda al cliente el recibo
-- por WhatsApp (vía CRM). El envío es asíncrono y puede fallar (PDF, CRM o
-- WhatsApp caídos), y Nexa puede reenviar el mismo evento. Estas columnas son
-- la bandeja de salida: evitan mandar el recibo dos veces y permiten
-- reintentarlo.
--
--   recibo_status: NULL (sin recibo: anterior a esto o con el envío apagado),
--                  PENDIENTE, ENVIANDO, ENVIADO, FALLIDO.
--   recibo_intentos: intentos hechos (tope 5).
--   recibo_actualizado_at: último cambio de estado; un ENVIANDO o FALLIDO de
--                  más de 30 minutos se puede volver a tomar.

ALTER TABLE cartera.nexa_payment_events
  ADD COLUMN IF NOT EXISTS recibo_status varchar(20),
  ADD COLUMN IF NOT EXISTS recibo_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recibo_actualizado_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS nexa_payment_events_idx_recibo_pendiente
  ON cartera.nexa_payment_events (recibo_actualizado_at)
  WHERE recibo_status IN ('PENDIENTE', 'ENVIANDO', 'FALLIDO');
