-- Condonación Nexa a tiempo sostenida por pagos PENDIENTES de validar.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Se aplica A MANO y va a producción ANTES que el código que la usa (después
-- de 0051). Es aditiva: una columna que admite NULL; el código anterior no la
-- conoce y sigue funcionando igual. Una sola sentencia, idempotente; no hace
-- falta envolverla en BEGIN/COMMIT.
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- La condonación a tiempo exige que el pago Nexa deje el crédito al día con el
-- criterio del cron. Una cuota vencida cubierta COMPLETA por un pago pendiente
-- (pagado=true, dentro de los 7 días que el cron le da a un pendiente) cuenta
-- como pagada, así que el crédito puede quedar al día gracias a ese pendiente.
-- Si después el pendiente se anula (falsePayment) o se revierte
-- (reversePayment) sin validarse, la condición de la condonación deja de
-- cumplirse y se anula sola.
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
-- • moras_condonaciones.pagos_pendientes_ids: los pago_id pendientes que
--   sostenían la condonación al decidirla. NULL = no dependía de ninguno.
--   Sin FK (un array no la admite y el pago puede borrarse): es un registro de
--   qué se tuvo en cuenta, igual que mora_pagada_cuota.pago_id (ver 0043).
-- • Sin índice: se busca siempre dentro de UN crédito (credito_id + `&&`),
--   y un crédito tiene pocas condonaciones. Tampoco hay que crear un índice
--   sobre una tabla viva en la ventana del despliegue.

ALTER TABLE cartera.moras_condonaciones
  ADD COLUMN IF NOT EXISTS pagos_pendientes_ids integer[];
