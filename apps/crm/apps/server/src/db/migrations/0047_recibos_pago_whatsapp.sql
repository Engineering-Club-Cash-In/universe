-- Idempotencia del recibo de pago por WhatsApp, por pago_id.
--
-- Cartera le pide al CRM que mande el recibo de cada pago aplicado y, en los
-- pagos de Nexa, reintenta si la respuesta no llega. Si el CRM ya había
-- mandado el mensaje pero la respuesta se cortó (timeout, reinicio), el
-- reintento lo mandaba otra vez. El CRM reserva el pago aquí ANTES de llamar
-- a WhatsApp: un pago ya enviado (o con un envío en curso) no se vuelve a
-- mandar.
--
--   estado: enviando | enviado | fallido (solo un fallido se puede reintentar).
CREATE TABLE IF NOT EXISTS recibos_pago_whatsapp (
	pago_id integer PRIMARY KEY,
	numero_credito_sifco text,
	estado text NOT NULL,
	intentos integer NOT NULL DEFAULT 1,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	actualizado_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT recibos_pago_whatsapp_estado_valido
		CHECK (estado IN ('enviando', 'enviado', 'fallido'))
);
