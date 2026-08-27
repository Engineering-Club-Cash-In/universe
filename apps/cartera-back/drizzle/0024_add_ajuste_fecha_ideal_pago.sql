-- Ingreso adicional (sin capital) por elegir un día de pago recomendado por IA
-- que cae después del día que el sistema hubiera asignado por default
-- (día≤20→15, día>20→30). Se calcula una vez en el CRM al cerrar la
-- oportunidad (ver apps/crm/apps/server/src/lib/fecha-ideal-pago-ajuste.ts).
-- 1 fila por crédito (uq_ajuste_fecha_ideal_pago_credito), solo cuando el
-- ajuste realmente aplica. Aditiva: no toca cartera.creditos ni
-- cartera.pagos_credito, es un INSERT aparte.
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit) -- ver 0016/0017/0018.
CREATE TABLE IF NOT EXISTS cartera.ajuste_fecha_ideal_pago (
  id                         serial PRIMARY KEY,
  credito_id                 integer NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  dia_pago_original_sistema  integer NOT NULL,
  dia_pago_mensual_elegido   integer NOT NULL,
  dias_diferencia            integer NOT NULL,
  dias_del_mes               integer NOT NULL,
  -- Interés proporcional bruto: interés base mensual + IVA del interés.
  monto_interes              numeric(18, 2) NOT NULL,
  monto_membresia            numeric(18, 2) NOT NULL,
  monto_servicios            numeric(18, 2) NOT NULL,
  monto_total                numeric(18, 2) NOT NULL,
  -- NULL = pendiente de cobrar; se llena cuando se aplica como "otros" en el
  -- pago de la cuota 1.
  fecha_cobro                timestamp with time zone,
  -- Qué fila de cartera.pagos_credito cobró el ajuste; permite resetear
  -- fecha_cobro/pago_id a NULL si ese pago se revierte o invalida.
  pago_id                    integer REFERENCES cartera.pagos_credito(pago_id) ON DELETE SET NULL,
  created_at                 timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ajuste_fecha_ideal_pago_credito
  ON cartera.ajuste_fecha_ideal_pago (credito_id);
