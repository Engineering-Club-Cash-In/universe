-- ============================================================================
-- traslado_pagos_normal_maria_elena_a_boca_terra.sql
--
-- COMPLEMENTO del script traslado_creditos_maria_elena_a_boca_terra.sql:
-- mueve los pagos de la tabla NORMAL (cartera.pagos_credito_inversionistas)
-- del origen al destino: TODAS sus filas, sin filtro de estado.
--
-- Correr DESPUÉS del traslado principal (o junto a él, mismo orden):
--   1) traslado_creditos_maria_elena_a_boca_terra.sql  (participaciones,
--      espejo, históricos, pagos espejo pendientes, abonos pendientes)
--   2) este script                                     (todos los pagos normal)
--
-- SE MUEVEN (inversionista_id origen → destino):
--   - cartera.pagos_credito_inversionistas: TODAS las filas del origen,
--     sin filtro de estado. Verificado en datos de PROD (2026-06-09): la
--     tabla entera (6,468 filas) está 100% en NO_LIQUIDADO con
--     liquidacion_id NULL — el estado y el enlace a liquidaciones nunca se
--     usan aquí; el flujo de liquidación corre sobre el espejo.
--
-- SALVAGUARDAS:
--   1) BACKUP de las filas afectadas en cartera.backup_traslado_pagos_inv.
--   2) ABORTA si algún pago del origen ya tiene fila del destino para el
--      mismo pago_id (violaría el unique unique_pago_inversionista; sería
--      un merge de distribución y se decide aparte).
--   3) Todo corre en UNA transacción: o se mueve todo o nada.
--
-- WARNING (no bloquea): lista pagos con liquidacion_id no nulo por si en
-- PROD apareciera alguno (no debería existir ninguno).
--
-- IDs según DEV (restore de PROD del 2026-06-09; CONFIRMAR contra PROD):
--   origen  = 96  → MARIA ELENA ROCA MARROQUIN        (dpi 1958265310101)
--   destino = 153 → Boca-Terra Group, Sociedad Anónima (dpi 2119613290101)
--
-- Uso (psql):
--   Preview:  psql "$PROD_URL" -v origen=96 -v destino=153 -v apply=0 -f scripts/traslado_pagos_normal_maria_elena_a_boca_terra.sql
--   Aplicar:  psql "$PROD_URL" -v origen=96 -v destino=153 -v apply=1 -f scripts/traslado_pagos_normal_maria_elena_a_boca_terra.sql
--
-- Sin variables = PREVIEW (no modifica nada).
-- ============================================================================

\set ON_ERROR_STOP on

\if :{?origen} \else \set origen 0 \endif
\if :{?destino} \else \set destino 0 \endif
\if :{?apply} \else \set apply 0 \endif

\echo ''
\echo '============================================================'
\echo ' IDENTIFICACIÓN DE INVERSIONISTAS'
\echo '============================================================'

SELECT inversionista_id, nombre, dpi, status
FROM cartera.inversionistas
WHERE inversionista_id IN (:origen, :destino);

\echo ''
\echo '============================================================'
\echo ' PREVIEW: TODOS los pagos normal del origen (se mueven todos)'
\echo '============================================================'

SELECT estado_liquidacion, count(*) AS filas, sum(cuota) AS total_cuota,
       count(DISTINCT credito_id) AS creditos
FROM cartera.pagos_credito_inversionistas
WHERE inversionista_id = :origen
GROUP BY estado_liquidacion;

\echo '--- Detalle por crédito ---'
SELECT credito_id, count(*) AS pagos, sum(cuota) AS total_cuota,
       min(fecha_pago)::date AS pago_mas_viejo, max(fecha_pago)::date AS pago_mas_nuevo
FROM cartera.pagos_credito_inversionistas
WHERE inversionista_id = :origen
GROUP BY credito_id
ORDER BY credito_id;

\echo ''
\echo '============================================================'
\echo ' CHECKS BLOQUEANTES'
\echo '============================================================'

\echo '--- Pagos donde el destino YA tiene fila del mismo pago_id (unique; BLOQUEA) ---'
SELECT p_o.pago_id, p_o.credito_id
FROM cartera.pagos_credito_inversionistas p_o
JOIN cartera.pagos_credito_inversionistas p_d
  ON p_d.pago_id = p_o.pago_id AND p_d.inversionista_id = :destino
WHERE p_o.inversionista_id = :origen;

\echo '--- WARNING (no bloquea): pagos con liquidacion_id no nulo (no debería haber) ---'
SELECT pago_id, credito_id, estado_liquidacion, liquidacion_id
FROM cartera.pagos_credito_inversionistas
WHERE inversionista_id = :origen
  AND liquidacion_id IS NOT NULL;

-- ============================================================================
-- APLICACIÓN
-- ============================================================================
\if :apply

\echo ''
\echo '>>> APLICANDO TRASLADO DE PAGOS NORMAL <<<'

BEGIN;

SELECT set_config('traslado.origen',  :'origen',  true),
       set_config('traslado.destino', :'destino', true);

DO $do$
DECLARE
  v_origen  int := current_setting('traslado.origen')::int;
  v_destino int := current_setting('traslado.destino')::int;
BEGIN
  RAISE NOTICE 'Validando traslado de pagos normal % -> %', v_origen, v_destino;

  IF NOT EXISTS (SELECT 1 FROM cartera.inversionistas WHERE inversionista_id = v_origen) THEN
    RAISE EXCEPTION 'Inversionista ORIGEN % no existe', v_origen;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cartera.inversionistas WHERE inversionista_id = v_destino) THEN
    RAISE EXCEPTION 'Inversionista DESTINO % no existe', v_destino;
  END IF;

  IF v_origen = v_destino THEN
    RAISE EXCEPTION 'Origen y destino son el mismo inversionista (%)', v_origen;
  END IF;

  -- Unique (pago_id, inversionista_id): el destino no puede tener ya una
  -- fila del mismo pago que se va a mover.
  IF EXISTS (
    SELECT 1
    FROM cartera.pagos_credito_inversionistas p_o
    JOIN cartera.pagos_credito_inversionistas p_d
      ON p_d.pago_id = p_o.pago_id AND p_d.inversionista_id = v_destino
    WHERE p_o.inversionista_id = v_origen
  ) THEN
    RAISE EXCEPTION 'ABORTADO: hay pagos del origen donde el destino ya tiene fila (unique_pago_inversionista). Requiere merge manual.';
  END IF;
END
$do$;

-- Backup ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_pagos_inv
  (LIKE cartera.pagos_credito_inversionistas, fecha_backup timestamptz DEFAULT now());

INSERT INTO cartera.backup_traslado_pagos_inv
  SELECT *, now() FROM cartera.pagos_credito_inversionistas
  WHERE inversionista_id = :origen;

-- Traslado --------------------------------------------------------------------
UPDATE cartera.pagos_credito_inversionistas
   SET inversionista_id = :destino
 WHERE inversionista_id = :origen;

-- Verificación post -------------------------------------------------------------
\echo ''
\echo '--- POST: pagos normal restantes del origen (debe ser 0) ---'
SELECT count(*) AS restantes_origen
FROM cartera.pagos_credito_inversionistas
WHERE inversionista_id = :origen;

\echo '--- POST: pagos normal ahora del destino ---'
SELECT estado_liquidacion, count(*) AS filas, sum(cuota) AS total_cuota
FROM cartera.pagos_credito_inversionistas
WHERE inversionista_id = :destino
GROUP BY estado_liquidacion;

COMMIT;

\echo ''
\echo '>>> PAGOS NORMAL TRASLADADOS. Backup en cartera.backup_traslado_pagos_inv <<<'

\else

\echo ''
\echo '>>> MODO PREVIEW: no se modificó nada. Usar -v apply=1 para aplicar. <<<'

\endif

-- ============================================================================
-- REVERSIÓN MANUAL (si algo sale mal después del COMMIT):
--
--   BEGIN;
--   UPDATE cartera.pagos_credito_inversionistas p
--      SET inversionista_id = b.inversionista_id
--     FROM cartera.backup_traslado_pagos_inv b
--    WHERE p.id = b.id;
--   COMMIT;
-- ============================================================================
