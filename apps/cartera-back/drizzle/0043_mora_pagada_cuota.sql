-- 🔴 ORDEN DE DESPLIEGUE — 0043 y 0044 van a producción ANTES que el código.
-- El código de este cambio escribe `moras_historial.pago_id` y lee/escribe
-- `mora_pagada_cuota` en cada pago que cobra mora, en cada condonación y en el
-- cron. Si el código sale primero, TODO eso falla ("column pago_id does not
-- exist" / "relation mora_pagada_cuota does not exist") hasta que corran las
-- migraciones. Aplicarlas a mano, verificar, y recién después desplegar.
--
-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- La tabla `mora_pagada_cuota` es el ledger auditado de mora cobrada o condonada
-- por cuota. Garantiza que el saldo de mora visible es siempre la suma exacta de
-- sus filas, sin asorciones de estado. Nunca se modifica una fila existente: se
-- reversa una con otra compensatoria que suma negativo.
--
-- La tabla es de solo agregar (append-only). Cuando se revierte un pago de mora,
-- se inserta una SEGUNDA fila con monto negativo que apunta a la original con
-- `revierte_a`. Así la reversa es exacta, auditable, y permite saber qué pago
-- volvió atrás sin tocar la fila que lo registró.
--
-- El índice `mora_pagada_cuota_uq_pago` bloquea a nivel base de datos la
-- condición de carrera: un doble clic sobre "registrar pago de mora" más rápido
-- que lo que la BD puede procesar. Sin el índice, dos conexiones llegan a insertar
-- dos filas con el MISMO pago_id y cuota_id, y el saldo de mora se duplica sin
-- rastro. La tabla `pagos_credito_inversionistas_espejo` VIVE sin unicidad y
-- costó un stack completo arreglarlo. Acá la unicidad es prevendedora.
-- Cuando `reversePayment` reutiliza la fila pagos_credito con un nuevo pago, la
-- fila PAGO anterior se compensa pero su pago_id sigue vivo; el siguiente pago la
-- vuelve a escribir con el MISMO pago_id. La columna `reemplaza_a` apunta a la
-- fila PAGO anterior compensada (la que haya sido compensada por revierte_a), y
-- el índice usa COALESCE(reemplaza_a, 0) para que (pago_id, cuota_id, 0) y
-- (pago_id, cuota_id, id_anterior) sean dos claves distintas: la vieja
-- compensada entra con clave (pago, cuota, id_anterior), la nueva entra con
-- clave (pago, cuota, 0). Por qué así: una doble anotación del MISMO pago vivo
-- calcula el mismo reemplaza_a que la fila viva → choca (la red contra dobles
-- sigue); después de revertir, reemplaza_a apunta a la fila compensada → clave
-- nueva → entra. Dos inserts concurrentes calculan lo mismo → choca uno.
--
-- El índice `mora_pagada_cuota_uq_revierte` impide revertir dos veces la misma
-- fila: una fila compensatoria puede apuntar a UNA sola fila original.
--
-- `pago_id` es NULL a propósito en las condonaciones: perdonar mora es agregar
-- un saldo favorable al cliente, igual que cobrar un pago, pero no trae ID de
-- pago porque no viene de una transacción de caja. La restricción exige que
-- `pago_id` sea NOT NULL solo cuando tipo='PAGO'.
--
-- `clock_timestamp()` en lugar de `now()`: `now()` devuelve el instante en que
-- abrió la transacción. Si dos operaciones sobre el mismo crédito corren en
-- paralelo, sus filas resultan fechadas FUERA DE ORDEN cronológico, rompiendo
-- el order by fecha DESC que usan los snapshots. Ya pasó en `moras_historial`
-- y costó una rebanada entera desanudarlo. `clock_timestamp()` devuelve el
-- instante de la escritura, no del BEGIN.

-- ── Por qué `pago_id` NO tiene llave foránea ────────────────────────────────
-- El sistema BORRA filas de `pagos_credito` al revertir un pago
-- (`reversePayment`), y también las herramientas de importación. Con una FK sin
-- regla de borrado, esa reversa choca contra esta tabla y se cae entera. Con
-- `ON DELETE CASCADE` se perdería el rastro de que ese pago existió; con
-- `ON DELETE SET NULL` se violaría la restricción de que toda fila PAGO lleve
-- su pago. Ninguna de las dos sirve.
--
-- Esta tabla es un REGISTRO: tiene que sobrevivir al pago que la originó. Por
-- eso `pago_id` es un número de referencia histórico, indexado pero sin FK. Que
-- apunte a un pago ya borrado es CORRECTO — dice "esto lo pagó el pago #N, que
-- después se revirtió", y la fila compensatoria lo confirma.

-- ── Por qué `monto` lleva 6 decimales y no 2 ────────────────────────────────
-- La mora de cada cuota sale con fracciones de centavo (capital × 1.12% ×
-- días/30) y se cobra redondeada en el TOTAL. Si cada fila del ledger se
-- redondeara a centavos, pagar exactamente la mora que ve el cliente dejaría
-- restos de fracción en varias cuotas que, sumados, redondean a Q0.01: el cron
-- lo cobraría y el crédito seguiría MOROSO por un centavo. Con 6 decimales se
-- anota lo abonado exacto y el resto no aparece. Lo que se muestra se redondea
-- a centavos al leerlo.

CREATE TABLE IF NOT EXISTS cartera.mora_pagada_cuota (
  id           serial PRIMARY KEY,
  credito_id   integer NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  cuota_id     integer NOT NULL REFERENCES cartera.cuotas_credito(cuota_id) ON DELETE CASCADE,
  pago_id      integer,  -- SIN llave foránea: ver la nota de abajo
  monto        numeric(18,6) NOT NULL,  -- 6 decimales: ver la nota de abajo
  tipo         text NOT NULL,
  revierte_a   integer          REFERENCES cartera.mora_pagada_cuota(id),
  reemplaza_a  integer          REFERENCES cartera.mora_pagada_cuota(id),
  usuario_id   integer,
  motivo       text,
  fecha        timestamp NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT mora_pagada_cuota_tipo_valido
    CHECK (tipo IN ('PAGO','CONDONACION','REVERSA','ANULACION')),

  CONSTRAINT mora_pagada_cuota_monto_no_cero
    CHECK (monto <> 0),

  CONSTRAINT mora_pagada_cuota_signo_por_tipo
    CHECK ( (tipo IN ('PAGO','CONDONACION') AND monto > 0)
         OR (tipo IN ('REVERSA','ANULACION') AND monto < 0) ),

  CONSTRAINT mora_pagada_cuota_pago_obligatorio_en_pago
    CHECK (tipo <> 'PAGO' OR pago_id IS NOT NULL),

  CONSTRAINT mora_pagada_cuota_compensatoria_apunta
    CHECK ( (tipo IN ('REVERSA','ANULACION')) = (revierte_a IS NOT NULL) ),

  CONSTRAINT mora_pagada_cuota_reemplaza_solo_pago
    CHECK (reemplaza_a IS NULL OR tipo = 'PAGO')
);

CREATE UNIQUE INDEX IF NOT EXISTS mora_pagada_cuota_uq_pago
  ON cartera.mora_pagada_cuota (pago_id, cuota_id, COALESCE(reemplaza_a, 0))
  WHERE tipo = 'PAGO';

CREATE UNIQUE INDEX IF NOT EXISTS mora_pagada_cuota_uq_revierte
  ON cartera.mora_pagada_cuota (revierte_a)
  WHERE revierte_a IS NOT NULL;

CREATE INDEX IF NOT EXISTS mora_pagada_cuota_idx_cuota
  ON cartera.mora_pagada_cuota (credito_id, cuota_id);

CREATE INDEX IF NOT EXISTS mora_pagada_cuota_idx_pago
  ON cartera.mora_pagada_cuota (pago_id) WHERE pago_id IS NOT NULL;
