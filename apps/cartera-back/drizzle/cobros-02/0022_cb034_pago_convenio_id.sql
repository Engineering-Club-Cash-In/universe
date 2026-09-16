-- COBROS-02 · Fase 3 — A QUÉ CONVENIO SE LE ACREDITÓ CADA PAGO.
--
-- `pagos_credito.pago_convenio` guarda CUÁNTO de la boleta se le acreditó a un
-- convenio, pero no A CUÁL. Revertir el pago tiene que descontárselo al mismo
-- convenio que lo recibió, y hasta hoy eso se adivinaba:
--
--  · "algún convenio del crédito" con `.limit(1)` — si el convenio se deshizo y
--    se firmó otro, la reversa le descontaba al nuevo, que nunca recibió ese
--    dinero;
--  · el pivot `convenios_pagos_resume` — tampoco sirve: se llena UNA vez, al
--    crear el convenio, con las filas pre-sembradas de las cuotas que
--    reestructura. Los pagos que después se le acreditan caen en otras filas.
--    En el sandbox, 196 de 204 pagos con `pago_convenio > 0` no tienen fila en
--    el pivot (review de Codex, P1).
--
-- La respuesta exacta solo existe en el momento de acreditar, así que se sella
-- ahí: la misma fila que carga el monto carga el convenio, y los escribe el
-- mismo estampador en el mismo acto (`crearEstampadorPagoConvenio`), así que no
-- pueden quedar desparejos.
--
-- NULL = fila que no cargó monto de convenio, o pago anterior a esta columna.
-- Para esos la reversa cae a un criterio de respaldo (ver reversePayment.ts).
--
-- Sin ON DELETE: el rechazo de un convenio NO aprobado lo borra en duro, pero
-- un convenio sin aprobar nunca recibe pagos (`processConvenioPaymentEnTx` solo
-- acredita `activo = true`), así que ninguna fila sellada puede apuntar a uno.
-- Si alguna vez pasara, que el DELETE falle es lo correcto: se estaría borrando
-- un convenio con plata aplicada.

ALTER TABLE cartera.pagos_credito
  ADD COLUMN IF NOT EXISTS convenio_id integer
    REFERENCES cartera.convenios_pago (convenio_id);
--> statement-breakpoint

-- La reversa busca por `pago_id` (PK), no por esto; el índice es para la otra
-- dirección —"qué pagos recibió este convenio"— que hoy nadie puede contestar.
-- Parcial: la inmensa mayoría de los pagos no son de convenio.
CREATE INDEX IF NOT EXISTS pagos_credito_convenio_id_idx
  ON cartera.pagos_credito (convenio_id)
  WHERE convenio_id IS NOT NULL;
