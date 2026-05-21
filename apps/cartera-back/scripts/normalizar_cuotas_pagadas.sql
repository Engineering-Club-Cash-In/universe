-- ============================================================================
-- normalizar_cuotas_pagadas.sql
--
-- Rellena los "huecos" de pago: para cada crédito, marca como pagadas las
-- cuotas anteriores a la última cuota pagada (mayor numero_cuota con
-- pagado = true).
--
-- SUPUESTO DE NEGOCIO: los pagos son SECUENCIALES (no hay prepagos / cuotas
-- salteadas). Si un cliente pagó hasta la cuota 40, las anteriores debieron
-- quedar pagadas; una cuota intermedia sin marcar infla el atraso y la mora.
--
-- SALVAGUARDAS (production-ready):
--   1) BACKUP: antes de modificar, guarda los cuota_id afectados en
--      cartera.cuotas_fill_backup → permite revertir un batch completo.
--   2) EXCLUYE cuotas con un pago en estado 'pending' (validation_status):
--      esas esperan validación, no se adelantan.
--
-- Uso (psql):
--   Preview masivo:        -v cid=0   -v apply=0
--   Aplicar masivo:        -v cid=0   -v apply=1
--   Preview un crédito:    -v cid=677 -v apply=0
--   Aplicar un crédito:    -v cid=677 -v apply=1
--   Revertir último batch: -v revert=1
--
-- Sin variables = PREVIEW MASIVO (no modifica nada).
--
-- IMPORTANTE: tras aplicar, correr procesarMoras para recalcular el atraso.
-- ============================================================================

-- Defaults seguros
\if :{?cid}
\else
  \set cid 0
\endif
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?revert}
\else
  \set revert 0
\endif

-- Tabla de respaldo (idempotente)
CREATE TABLE IF NOT EXISTS cartera.cuotas_fill_backup (
  backup_id       SERIAL PRIMARY KEY,
  cuota_id        INTEGER NOT NULL,
  credito_id      INTEGER,
  numero_cuota    INTEGER,
  pagado_anterior BOOLEAN,
  fill_batch      TIMESTAMP NOT NULL DEFAULT now()
);

\if :revert
-- ============================ MODO REVERT ============================
  \echo '>>> REVIRTIENDO el último batch de fill...'
  BEGIN;
  UPDATE cartera.cuotas_credito cu
  SET pagado = b.pagado_anterior
  FROM cartera.cuotas_fill_backup b
  WHERE b.cuota_id = cu.cuota_id
    AND b.fill_batch = (SELECT max(fill_batch) FROM cartera.cuotas_fill_backup);

  DELETE FROM cartera.cuotas_fill_backup
  WHERE fill_batch = (SELECT max(fill_batch) FROM cartera.cuotas_fill_backup);
  COMMIT;
  \echo '>>> Revertido (cuotas restauradas a su pagado anterior). Recalcular moras.'

\else
-- ============================ PREVIEW ============================
  \echo '=========================================================='
  \echo 'normalizar_cuotas_pagadas  (cid=' :cid '  apply=' :apply ')'
  \echo '   cid=0 -> todos | apply=1 -> aplica | (excluye pagos pending)'
  \echo '=========================================================='

  -- Resumen: a rellenar vs excluidas por pending
  WITH ult AS (
    SELECT credito_id, MAX(numero_cuota) AS ult_pagada
    FROM cartera.cuotas_credito
    WHERE pagado = true AND (:cid = 0 OR credito_id = :cid)
    GROUP BY credito_id
  ),
  huecos AS (
    SELECT cu.cuota_id, cu.credito_id, cu.numero_cuota,
           EXISTS (SELECT 1 FROM cartera.pagos_credito p
                   WHERE p.cuota_id = cu.cuota_id AND p.validation_status = 'pending') AS tiene_pending
    FROM cartera.cuotas_credito cu
    JOIN ult ON ult.credito_id = cu.credito_id
    WHERE cu.pagado = false AND cu.numero_cuota < ult.ult_pagada
  )
  SELECT
    count(*) FILTER (WHERE NOT tiene_pending)                    AS cuotas_a_rellenar,
    count(DISTINCT credito_id) FILTER (WHERE NOT tiene_pending)  AS creditos_a_rellenar,
    count(*) FILTER (WHERE tiene_pending)                        AS cuotas_excluidas_pending
  FROM huecos;

  -- Detalle de las que SÍ se rellenarían (sin pending)
  \echo '--- Cuotas a rellenar (sin pago pending) ---'
  WITH ult AS (
    SELECT credito_id, MAX(numero_cuota) AS ult_pagada
    FROM cartera.cuotas_credito
    WHERE pagado = true AND (:cid = 0 OR credito_id = :cid)
    GROUP BY credito_id
  )
  SELECT cu.credito_id, c.numero_credito_sifco AS sifco, ult.ult_pagada,
         count(*) AS huecos,
         string_agg(cu.numero_cuota::text, ',' ORDER BY cu.numero_cuota) AS cuotas
  FROM cartera.cuotas_credito cu
  JOIN ult ON ult.credito_id = cu.credito_id
  JOIN cartera.creditos c ON c.credito_id = cu.credito_id
  WHERE cu.pagado = false AND cu.numero_cuota < ult.ult_pagada
    AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito p
                    WHERE p.cuota_id = cu.cuota_id AND p.validation_status = 'pending')
  GROUP BY cu.credito_id, c.numero_credito_sifco, ult.ult_pagada
  ORDER BY huecos DESC LIMIT 50;

  -- Detalle de las EXCLUIDAS por pending (para visibilidad)
  \echo '--- Cuotas EXCLUIDAS por tener pago pending (NO se tocan) ---'
  WITH ult AS (
    SELECT credito_id, MAX(numero_cuota) AS ult_pagada
    FROM cartera.cuotas_credito
    WHERE pagado = true AND (:cid = 0 OR credito_id = :cid)
    GROUP BY credito_id
  )
  SELECT cu.credito_id, c.numero_credito_sifco AS sifco,
         string_agg(cu.numero_cuota::text, ',' ORDER BY cu.numero_cuota) AS cuotas_excluidas
  FROM cartera.cuotas_credito cu
  JOIN ult ON ult.credito_id = cu.credito_id
  JOIN cartera.creditos c ON c.credito_id = cu.credito_id
  WHERE cu.pagado = false AND cu.numero_cuota < ult.ult_pagada
    AND EXISTS (SELECT 1 FROM cartera.pagos_credito p
                WHERE p.cuota_id = cu.cuota_id AND p.validation_status = 'pending')
  GROUP BY cu.credito_id, c.numero_credito_sifco
  ORDER BY cu.credito_id LIMIT 50;

  -- ============================ APPLY ============================
  \if :apply
    \echo '>>> APLICANDO (backup + update en una transacción)...'
    BEGIN;

    -- 1) Backup de lo que se va a cambiar (mismo fill_batch = now() de la tx)
    INSERT INTO cartera.cuotas_fill_backup (cuota_id, credito_id, numero_cuota, pagado_anterior)
    SELECT cu.cuota_id, cu.credito_id, cu.numero_cuota, cu.pagado
    FROM cartera.cuotas_credito cu
    JOIN (
      SELECT credito_id, MAX(numero_cuota) AS ult_pagada
      FROM cartera.cuotas_credito
      WHERE pagado = true AND (:cid = 0 OR credito_id = :cid)
      GROUP BY credito_id
    ) ult ON ult.credito_id = cu.credito_id
    WHERE cu.pagado = false AND cu.numero_cuota < ult.ult_pagada
      AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito p
                      WHERE p.cuota_id = cu.cuota_id AND p.validation_status = 'pending');

    -- 2) Update solo de las respaldadas en este batch
    UPDATE cartera.cuotas_credito cu
    SET pagado = true
    FROM cartera.cuotas_fill_backup b
    WHERE b.cuota_id = cu.cuota_id
      AND b.fill_batch = (SELECT max(fill_batch) FROM cartera.cuotas_fill_backup);

    COMMIT;
    \echo '>>> Listo. Batch guardado en cartera.cuotas_fill_backup.'
    \echo '>>> Para revertir este batch:  psql ... -v revert=1 -f normalizar_cuotas_pagadas.sql'
    \echo '>>> Recordatorio: correr procesarMoras para recalcular el atraso.'
  \else
    \echo '(MODO PREVIEW: no se modificó nada. Usa -v apply=1 para aplicar.)'
  \endif
\endif
