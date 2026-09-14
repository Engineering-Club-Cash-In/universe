-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- rubros_pagos: el VÍNCULO entre una boleta y los rubros que esa boleta cobra.
--
-- Por qué hace falta una tabla y no basta con `rubros_historial`: el pago corre
-- en DOS ETAPAS. `POST /newPayment` sólo ESCRIBE filas en `pagos_credito` con
-- `validation_status = 'pending'` — no mueve plata; la plata se mueve en
-- `/aplicar-pago`, cuando contabilidad valida. La regla del dueño del dominio
-- es que el saldo del rubro baje al APLICAR, no al registrar: registrar sólo
-- APARTA. Esta tabla es donde vive ese "apartado" mientras tanto.
--
-- Cada fila es un reclamo: "la boleta X apartó Q120 del rubro Y".
--   * `monto` es lo APARTADO en el registro, contra el saldo neto del rubro.
--   * `aplicado` dice si contabilidad ya validó la boleta.
--   * `monto_aplicado` es lo que REALMENTE se descontó del rubro al aplicar.
--     Va nullable porque hasta que la boleta se aplica no existe: un 0 ahí
--     sería indistinguible de "se aplicó y no descontó nada".
--
-- El estado terminal de un reclamo es la ausencia de la fila: la reversa borra
-- el reclamo (devolviendo el saldo si ya estaba aplicado), y por eso una
-- segunda reversa del mismo pago no encuentra nada que devolver — mismo
-- criterio con el que el convenio se protege dejando su sello en 0.
--
-- Todo en el schema cartera. IF NOT EXISTS para que el archivo sea
-- re-ejecutable, y SIN `ALTER TYPE ... ADD VALUE` (ver la nota de 0036): este
-- archivo entero es aplicable dentro de una transacción (`psql -1`).

CREATE TABLE IF NOT EXISTS cartera.rubros_pagos (
  id SERIAL PRIMARY KEY,
  -- CASCADE: la reversa de un pago parcial BORRA la fila de `pagos_credito`
  -- (reversePayment.ts), y un reclamo huérfano apuntando a un pago que ya no
  -- existe congelaría la edición del rubro para siempre. La reversa procesa los
  -- reclamos ANTES de ese borrado, así que la cascada es la red, no el camino.
  pago_id INTEGER NOT NULL REFERENCES cartera.pagos_credito(pago_id) ON DELETE CASCADE,
  -- SIN cascada (el default NO ACTION alcanza): un rubro no se borra nunca
  -- —se anula— y si alguien lo intentara, llevarse en silencio la evidencia de
  -- lo que un cliente pagó es justo lo que este módulo existe para impedir.
  rubro_id INTEGER NOT NULL REFERENCES cartera.rubros(rubro_id),
  -- Lo APARTADO al registrar la boleta. No baja el saldo del rubro.
  monto NUMERIC(18, 2) NOT NULL,
  -- Lo REALMENTE descontado al aplicar. NULL mientras la boleta espera a conta.
  monto_aplicado NUMERIC(18, 2),
  aplicado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- "¿Qué rubros cobró esta boleta?" — lo pregunta la aplicación y la reversa,
-- una vez por pago.
CREATE INDEX IF NOT EXISTS rubros_pagos_pago_idx
  ON cartera.rubros_pagos (pago_id);

-- "¿Este rubro tiene reclamos VIVOS?" — lo pregunta cada edición y cada
-- anulación (es el bloqueo de 409 que hace imposible el descuadre), y también
-- el neteo contra boletas hermanas en cada registro de pago. Es la consulta
-- caliente del módulo, y por eso el índice lleva `aplicado`: sin él, un rubro
-- con años de reclamos ya aplicados obliga a recorrerlos todos para descubrir
-- que ninguno sigue vivo.
CREATE INDEX IF NOT EXISTS rubros_pagos_rubro_aplicado_idx
  ON cartera.rubros_pagos (rubro_id, aplicado);
