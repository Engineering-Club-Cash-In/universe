-- Reserva de la bienvenida automática por crédito.
--
-- La bienvenida al cerrar al 90% la manda el disparo de confirmContractsSigned
-- y, si se perdió, el barrido jobs/bienvenida-pendiente.ts. Con dos procesos
-- del CRM a la vez (un despliegue con instancias solapadas) los dos podían
-- leer el mismo crédito sin bienvenida y mandarla dos veces. El envío
-- automático reserva el crédito aquí ANTES de llamar a WhatsApp. El envío
-- manual de la plantilla (masivo o ficha) no pasa por esta tabla.
--
--   estado: enviando | enviada | fallida (solo una fallida se puede reintentar).
CREATE TABLE IF NOT EXISTS bienvenidas_credito (
	numero_credito_sifco text PRIMARY KEY,
	estado text NOT NULL,
	intentos integer NOT NULL DEFAULT 1,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	actualizado_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT bienvenidas_credito_estado_valido
		CHECK (estado IN ('enviando', 'enviada', 'fallida'))
);
