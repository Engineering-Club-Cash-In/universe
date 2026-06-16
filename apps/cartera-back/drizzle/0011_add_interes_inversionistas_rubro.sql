-- Nuevo rubro para la FACTURACIÓN DE INVERSIONISTAS en facturacion_desglose:
-- el residuo del interés que NO factura CUBE = (interés total del pago con IVA)
-- − (interés que factura CUBE). cofidi lo guarda como 1 fila por pago
-- (factura_id NULL, ya con IVA). El snapshot diario lee facturacion_inversionistas
-- de este rubro de aquí en adelante (los días históricos quedan en 0 hasta
-- que se re-facture el pago).
--
-- ADD VALUE IF NOT EXISTS es idempotente (Postgres 10+). Debe correrse y
-- commitearse ANTES de desplegar el código que usa el valor.
ALTER TYPE cartera.rubro_facturacion ADD VALUE IF NOT EXISTS 'INTERES_INVERSIONISTAS';
