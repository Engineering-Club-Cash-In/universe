-- ============================================================================
-- traslado_creditos_maria_elena_a_boca_terra.sql
--
-- Traslada la PARTICIPACIÓN EN CRÉDITOS de un inversionista persona natural
-- (María Elena Roca) a su sociedad (Boca-Terra), manteniendo el historial de
-- liquidaciones y pagos a nombre de la persona original.
--
-- SE MUEVEN (inversionista_id origen → destino):
--   1) cartera.creditos_inversionistas          → participación vigente
--   2) cartera.creditos_inversionistas_espejo   → participación espejo
--   3) cartera.historico_liquidaciones_espejo   → snapshots de monto aportado
--   4) cartera.historico_monto_aportado_espejo  → auditoría de cambios de monto
--
-- NO SE MUEVEN (quedan a nombre de María Elena):
--   - cartera.liquidaciones
--   - cartera.pagos_credito_inversionistas
--   - cartera.pagos_credito_inversionistas_espejo
--   - cartera.boletas_pago_inversionista
--   - cartera.reinversiones
--   - cartera.abonos_capital                (✋ BLOQUEA si hay sin liquidar)
--   - cartera.compras_credito_inversionista (✋ BLOQUEA si hay pendientes)
--   - cartera.documentos_inversionista
--
-- EFECTO DE NEGOCIO: a partir del traslado, los NUEVOS pagos de esos créditos
-- se reparten a Boca-Terra (payments.ts lee creditos_inversionistas), y las
-- próximas liquidaciones de esos pagos salen a nombre de Boca-Terra. Todo lo
-- ya pagado/liquidado queda intacto a nombre de María Elena.
--
-- SALVAGUARDAS:
--   1) BACKUP: copia las filas afectadas de las 4 tablas a tablas
--      cartera.backup_traslado_* antes de modificar (permite revertir).
--   2) ABORTA si el destino ya participa en alguno de los créditos del origen
--      (violaría los unique ux_credito_inversionista / _espejo; ese caso es
--      un MERGE de participaciones y debe decidirse aparte).
--   3) ABORTA si el origen tiene compras/reinversiones con status <> completado
--      o abonos a capital sin liquidar: hay que COMPLETARLOS PRIMERO y luego
--      correr el traslado limpio (si se movieran a medias, la aceptación y la
--      liquidación pierden el par credito+inversionista y quedan atorados).
--   4) ABORTA si el origen tiene pagos con estado_liquidacion <> LIQUIDADO en
--      pagos_credito_inversionistas o en el espejo: el traslado exige que la
--      ÚLTIMA liquidación del origen ya haya corrido (origen 100% liquidado).
--   5) Todo corre en UNA transacción: o se mueve todo o nada.
--
-- OPCIONAL (bloque al final, -v mover_ultima_liq=1): mover la ÚLTIMA
-- liquidación del origen (la del corte final, liquidada a nombre de María
-- Elena) al destino, junto con sus pagos (vía liquidacion_id) y su boleta de
-- pago — para que esa liquidación quede como parte de la sociedad.
--
-- IDs según DEV (restore de PROD del 2026-06; CONFIRMAR contra PROD antes de correr):
--   origen  = 96  → MARIA ELENA ROCA MARROQUIN        (dpi 1958265310101)
--   destino = 153 → Boca-Terra Group, Sociedad Anónima (dpi 2119613290101)
--
-- Uso (psql):
--   Preview:  psql "$PROD_URL" -v origen=96 -v destino=153 -v apply=0 -f scripts/traslado_creditos_maria_elena_a_boca_terra.sql
--   Aplicar:  psql "$PROD_URL" -v origen=96 -v destino=153 -v apply=1 -f scripts/traslado_creditos_maria_elena_a_boca_terra.sql
--
-- Sin variables = PREVIEW (no modifica nada).
--
-- ⚠ ANTES DE CORRER EN PROD, el reviewer debe validar:
--   - IDs reales de origen/destino en PROD (verificarlos con la query de
--     "IDENTIFICACIÓN" de abajo; no asumir que coinciden con dev).
--   - ORDEN OPERATIVO: 1) correr la ÚLTIMA liquidación de María Elena en el
--     sistema → 2) preview de este script (todo en 0) → 3) apply=1 →
--     4) opcional: mover_ultima_liq=1 si el negocio decide que esa última
--     liquidación pase a nombre de la sociedad.
--   - OJO con el check #4: en dev (2026-06-09) hay 61 pagos NO_LIQUIDADO en
--     pagos_credito_inversionistas (tabla padre) aunque el espejo está en 0.
--     Si la liquidación NO marca también la tabla padre (el flujo corre sobre
--     el espejo), esas filas legacy van a bloquear el apply: el reviewer debe
--     confirmar si son residuales y, de serlo, marcarlas LIQUIDADO o ajustar
--     el check antes de correr.
--   - Si hay triggers de auditoría sobre creditos_inversionistas_espejo
--     (historico_monto_aportado_espejo se llena por trigger): el UPDATE de
--     inversionista_id puede generar filas de auditoría espurias.
-- ============================================================================

-- Cortar en seco al primer error (la EXCEPTION del DO aborta todo el script)
\set ON_ERROR_STOP on

-- Defaults seguros (preview, IDs imposibles para forzar identificación)
\if :{?origen} \else \set origen 0 \endif
\if :{?destino} \else \set destino 0 \endif
\if :{?apply} \else \set apply 0 \endif

\echo ''
\echo '============================================================'
\echo ' IDENTIFICACIÓN DE INVERSIONISTAS'
\echo '============================================================'

SELECT inversionista_id, nombre, dpi, email, status, emite_factura
FROM cartera.inversionistas
WHERE inversionista_id IN (:origen, :destino)
   OR nombre ILIKE '%maria%elena%roca%'
   OR nombre ILIKE '%boca%terra%';

\echo ''
\echo '============================================================'
\echo ' PREVIEW: filas que se moverían por tabla'
\echo '============================================================'

SELECT 'creditos_inversionistas' AS tabla, count(*) AS filas,
       count(DISTINCT credito_id) AS creditos
FROM cartera.creditos_inversionistas WHERE inversionista_id = :origen
UNION ALL
SELECT 'creditos_inversionistas_espejo', count(*), count(DISTINCT credito_id)
FROM cartera.creditos_inversionistas_espejo WHERE inversionista_id = :origen
UNION ALL
SELECT 'historico_liquidaciones_espejo', count(*), count(DISTINCT credito_id)
FROM cartera.historico_liquidaciones_espejo WHERE inversionista_id = :origen
UNION ALL
SELECT 'historico_monto_aportado_espejo', count(*), count(DISTINCT credito_id)
FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :origen;

\echo ''
\echo '--- Detalle de créditos a trasladar (participación vigente) ---'
SELECT ci.credito_id, c.numero_credito_sifco, c."statusCredit",
       ci.monto_aportado, ci.porcentaje_participacion_inversionista,
       ci.cuota_inversionista
FROM cartera.creditos_inversionistas ci
JOIN cartera.creditos c ON c.credito_id = ci.credito_id
WHERE ci.inversionista_id = :origen
ORDER BY ci.credito_id;

\echo ''
\echo '============================================================'
\echo ' CHECK BLOQUEANTE: créditos donde el destino YA participa'
\echo ' (si devuelve filas, el script aborta en apply: es un MERGE)'
\echo '============================================================'

SELECT ci_o.credito_id, 'creditos_inversionistas' AS tabla
FROM cartera.creditos_inversionistas ci_o
JOIN cartera.creditos_inversionistas ci_d
  ON ci_d.credito_id = ci_o.credito_id AND ci_d.inversionista_id = :destino
WHERE ci_o.inversionista_id = :origen
UNION ALL
SELECT cie_o.credito_id, 'creditos_inversionistas_espejo'
FROM cartera.creditos_inversionistas_espejo cie_o
JOIN cartera.creditos_inversionistas_espejo cie_d
  ON cie_d.credito_id = cie_o.credito_id AND cie_d.inversionista_id = :destino
WHERE cie_o.inversionista_id = :origen;

\echo ''
\echo '============================================================'
\echo ' CHECKS BLOQUEANTES: operaciones en vuelo del origen'
\echo ' (si devuelven filas, el apply ABORTA: completarlas primero)'
\echo '============================================================'

\echo '--- Abonos a capital del origen sin liquidar (BLOQUEA) ---'
SELECT abono_id, credito_id, monto, tipo, created_at
FROM cartera.abonos_capital
WHERE inversionista_id = :origen AND liquidado = false;

\echo '--- Compras/reinversiones del origen pendientes (BLOQUEA) ---'
SELECT id, credito_id, tipo_operacion, status, monto_aportado, fecha
FROM cartera.compras_credito_inversionista
WHERE inversionista_id = :origen AND status <> 'completado';

\echo '--- Pagos del origen sin liquidar, normal y espejo (BLOQUEA) ---'
\echo '    El traslado exige origen 100% liquidado: correr su liquidación primero.'
SELECT 'pagos_credito_inversionistas' AS tabla, estado_liquidacion, count(*) AS filas,
       sum(cuota) AS total_cuota
FROM cartera.pagos_credito_inversionistas
WHERE inversionista_id = :origen AND estado_liquidacion <> 'LIQUIDADO'
GROUP BY estado_liquidacion
UNION ALL
SELECT 'pagos_credito_inversionistas_espejo', estado_liquidacion, count(*), sum(cuota)
FROM cartera.pagos_credito_inversionistas_espejo
WHERE inversionista_id = :origen AND estado_liquidacion <> 'LIQUIDADO'
GROUP BY estado_liquidacion;

-- ============================================================================
-- APLICACIÓN
-- ============================================================================
\if :apply

\echo ''
\echo '>>> APLICANDO TRASLADO <<<'

BEGIN;

-- Validaciones duras ---------------------------------------------------------
-- psql NO interpola :variables dentro de bloques DO $$...$$, así que se pasan
-- como settings de sesión y se leen con current_setting().
SELECT set_config('traslado.origen',  :'origen',  true),
       set_config('traslado.destino', :'destino', true);

DO $do$
DECLARE
  v_origen  int := current_setting('traslado.origen')::int;
  v_destino int := current_setting('traslado.destino')::int;
BEGIN
  RAISE NOTICE 'Validando traslado % -> %', v_origen, v_destino;

  IF NOT EXISTS (SELECT 1 FROM cartera.inversionistas WHERE inversionista_id = v_origen) THEN
    RAISE EXCEPTION 'Inversionista ORIGEN % no existe', v_origen;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cartera.inversionistas WHERE inversionista_id = v_destino) THEN
    RAISE EXCEPTION 'Inversionista DESTINO % no existe', v_destino;
  END IF;

  IF v_origen = v_destino THEN
    RAISE EXCEPTION 'Origen y destino son el mismo inversionista (%)', v_origen;
  END IF;

  -- Conflicto de unique: destino ya participa en algún crédito del origen
  IF EXISTS (
    SELECT 1
    FROM cartera.creditos_inversionistas ci_o
    JOIN cartera.creditos_inversionistas ci_d
      ON ci_d.credito_id = ci_o.credito_id AND ci_d.inversionista_id = v_destino
    WHERE ci_o.inversionista_id = v_origen
  ) THEN
    RAISE EXCEPTION 'ABORTADO: el destino ya participa en créditos del origen (creditos_inversionistas). Requiere MERGE manual.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cartera.creditos_inversionistas_espejo cie_o
    JOIN cartera.creditos_inversionistas_espejo cie_d
      ON cie_d.credito_id = cie_o.credito_id AND cie_d.inversionista_id = v_destino
    WHERE cie_o.inversionista_id = v_origen
  ) THEN
    RAISE EXCEPTION 'ABORTADO: el destino ya participa en créditos del origen (espejo). Requiere MERGE manual.';
  END IF;

  -- Operaciones en vuelo del origen: si se mueve el espejo con esto pendiente,
  -- la aceptación (completeEspejo/compraCarteraAceptada) ya no encuentra el par
  -- (credito_id, inversionista_id) y la operación queda atorada para siempre.
  IF EXISTS (
    SELECT 1 FROM cartera.compras_credito_inversionista
    WHERE inversionista_id = v_origen AND status <> 'completado'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: el origen % tiene compras/reinversiones con status <> completado. Completarlas y volver a correr.', v_origen;
  END IF;

  -- Abonos a capital sin liquidar: tras el traslado la liquidación busca por el
  -- inversionista vigente (destino) y el abono del origen queda huérfano.
  IF EXISTS (
    SELECT 1 FROM cartera.abonos_capital
    WHERE inversionista_id = v_origen AND liquidado = false
  ) THEN
    RAISE EXCEPTION 'ABORTADO: el origen % tiene abonos a capital sin liquidar. Liquidarlos y volver a correr.', v_origen;
  END IF;

  -- Pagos sin liquidar (normal y espejo): el traslado solo procede con el
  -- origen 100% liquidado (su última liquidación ya corrida). Si esto aborta,
  -- correr la liquidación del origen primero.
  IF EXISTS (
    SELECT 1 FROM cartera.pagos_credito_inversionistas
    WHERE inversionista_id = v_origen AND estado_liquidacion <> 'LIQUIDADO'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: el origen % tiene pagos NO_LIQUIDADO/POR_LIQUIDAR en pagos_credito_inversionistas. Liquidar primero.', v_origen;
  END IF;

  IF EXISTS (
    SELECT 1 FROM cartera.pagos_credito_inversionistas_espejo
    WHERE inversionista_id = v_origen AND estado_liquidacion <> 'LIQUIDADO'
  ) THEN
    RAISE EXCEPTION 'ABORTADO: el origen % tiene pagos NO_LIQUIDADO/POR_LIQUIDAR en el espejo. Liquidar primero.', v_origen;
  END IF;
END
$do$;

-- Backups -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_creditos_inversionistas
  (LIKE cartera.creditos_inversionistas, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_creditos_inv_espejo
  (LIKE cartera.creditos_inversionistas_espejo, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_historico_liq_espejo
  (LIKE cartera.historico_liquidaciones_espejo, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_historico_monto_espejo
  (LIKE cartera.historico_monto_aportado_espejo, fecha_backup timestamptz DEFAULT now());

INSERT INTO cartera.backup_traslado_creditos_inversionistas
  SELECT *, now() FROM cartera.creditos_inversionistas WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_creditos_inv_espejo
  SELECT *, now() FROM cartera.creditos_inversionistas_espejo WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_historico_liq_espejo
  SELECT *, now() FROM cartera.historico_liquidaciones_espejo WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_historico_monto_espejo
  SELECT *, now() FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :origen;

-- Traslado ------------------------------------------------------------------
UPDATE cartera.creditos_inversionistas
   SET inversionista_id = :destino
 WHERE inversionista_id = :origen;

UPDATE cartera.creditos_inversionistas_espejo
   SET inversionista_id = :destino,
       updated_at = now()
 WHERE inversionista_id = :origen;

UPDATE cartera.historico_liquidaciones_espejo
   SET inversionista_id = :destino
 WHERE inversionista_id = :origen;

UPDATE cartera.historico_monto_aportado_espejo
   SET inversionista_id = :destino
 WHERE inversionista_id = :origen;

-- Verificación post-traslado --------------------------------------------------
\echo ''
\echo '--- POST: filas restantes a nombre del origen (deben ser 0) ---'
SELECT 'creditos_inversionistas' AS tabla, count(*) AS restantes
FROM cartera.creditos_inversionistas WHERE inversionista_id = :origen
UNION ALL
SELECT 'creditos_inversionistas_espejo', count(*)
FROM cartera.creditos_inversionistas_espejo WHERE inversionista_id = :origen
UNION ALL
SELECT 'historico_liquidaciones_espejo', count(*)
FROM cartera.historico_liquidaciones_espejo WHERE inversionista_id = :origen
UNION ALL
SELECT 'historico_monto_aportado_espejo', count(*)
FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :origen;

\echo ''
\echo '--- POST: filas ahora a nombre del destino ---'
SELECT 'creditos_inversionistas' AS tabla, count(*) AS filas
FROM cartera.creditos_inversionistas WHERE inversionista_id = :destino
UNION ALL
SELECT 'creditos_inversionistas_espejo', count(*)
FROM cartera.creditos_inversionistas_espejo WHERE inversionista_id = :destino
UNION ALL
SELECT 'historico_liquidaciones_espejo', count(*)
FROM cartera.historico_liquidaciones_espejo WHERE inversionista_id = :destino
UNION ALL
SELECT 'historico_monto_aportado_espejo', count(*)
FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :destino;

\echo ''
\echo '--- Lo que NO se movió (debe seguir a nombre del origen) ---'
SELECT 'liquidaciones' AS tabla, count(*) AS filas
FROM cartera.liquidaciones WHERE inversionista_id = :origen
UNION ALL
SELECT 'pagos_credito_inversionistas', count(*)
FROM cartera.pagos_credito_inversionistas WHERE inversionista_id = :origen
UNION ALL
SELECT 'pagos_credito_inversionistas_espejo', count(*)
FROM cartera.pagos_credito_inversionistas_espejo WHERE inversionista_id = :origen;

COMMIT;

\echo ''
\echo '>>> TRASLADO COMPLETADO. Backups en cartera.backup_traslado_* <<<'

\else

\echo ''
\echo '>>> MODO PREVIEW: no se modificó nada. Usar -v apply=1 para aplicar. <<<'

\endif

-- ============================================================================
-- OPCIONAL: mover la ÚLTIMA liquidación del origen al destino
-- ============================================================================
-- Contexto: la liquidación del día siguiente al corte será la ÚLTIMA de María
-- Elena. El negocio puede decidir que, aunque se liquidó a su nombre, esa
-- liquidación pase a formar parte de su sociedad (Boca-Terra). Este bloque
-- mueve al destino:
--   - la liquidación más reciente del origen (cartera.liquidaciones)
--   - los pagos enlazados a ella (pagos_credito_inversionistas y _espejo,
--     vía liquidacion_id)
--   - la boleta de pago que la originó (boletas_pago_inversionista, vía
--     liquidaciones.boleta_id)
-- Las liquidaciones ANTERIORES del origen no se tocan.
--
-- Uso (independiente del apply principal; puede correrse después):
--   psql "$PROD_URL" -v origen=96 -v destino=153 -v mover_ultima_liq=1 \
--        -f scripts/traslado_creditos_maria_elena_a_boca_terra.sql
-- ============================================================================
\if :{?mover_ultima_liq} \else \set mover_ultima_liq 0 \endif

\if :mover_ultima_liq

\echo ''
\echo '>>> MOVIENDO ÚLTIMA LIQUIDACIÓN DEL ORIGEN AL DESTINO <<<'

BEGIN;

-- La última liquidación del origen (por fecha; desempate por id)
CREATE TEMP TABLE _ultima_liq ON COMMIT DROP AS
SELECT liquidacion_id, boleta_id, fecha_liquidacion, total_cuota
FROM cartera.liquidaciones
WHERE inversionista_id = :origen
ORDER BY fecha_liquidacion DESC, liquidacion_id DESC
LIMIT 1;

\echo '--- Liquidación que se va a mover (VERIFICAR que sea la esperada) ---'
SELECT * FROM _ultima_liq;

-- Aborta si el origen no tiene liquidaciones
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ultima_liq) THEN
    RAISE EXCEPTION 'ABORTADO: el origen no tiene liquidaciones que mover.';
  END IF;
END
$do$;

-- Backups -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_liquidaciones
  (LIKE cartera.liquidaciones, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_pagos_inv
  (LIKE cartera.pagos_credito_inversionistas, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_pagos_inv_espejo
  (LIKE cartera.pagos_credito_inversionistas_espejo, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_boletas
  (LIKE cartera.boletas_pago_inversionista, fecha_backup timestamptz DEFAULT now());

INSERT INTO cartera.backup_traslado_liquidaciones
  SELECT l.*, now() FROM cartera.liquidaciones l
  WHERE l.liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq);
INSERT INTO cartera.backup_traslado_pagos_inv
  SELECT p.*, now() FROM cartera.pagos_credito_inversionistas p
  WHERE p.liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq);
INSERT INTO cartera.backup_traslado_pagos_inv_espejo
  SELECT p.*, now() FROM cartera.pagos_credito_inversionistas_espejo p
  WHERE p.liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq);
INSERT INTO cartera.backup_traslado_boletas
  SELECT b.*, now() FROM cartera.boletas_pago_inversionista b
  WHERE b.boleta_id IN (SELECT boleta_id FROM _ultima_liq WHERE boleta_id IS NOT NULL);

-- Traslado ------------------------------------------------------------------
UPDATE cartera.pagos_credito_inversionistas
   SET inversionista_id = :destino
 WHERE liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq)
   AND inversionista_id = :origen;

UPDATE cartera.pagos_credito_inversionistas_espejo
   SET inversionista_id = :destino,
       updated_at = now()
 WHERE liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq)
   AND inversionista_id = :origen;

UPDATE cartera.boletas_pago_inversionista
   SET inversionista_id = :destino
 WHERE boleta_id IN (SELECT boleta_id FROM _ultima_liq WHERE boleta_id IS NOT NULL)
   AND inversionista_id = :origen;

UPDATE cartera.liquidaciones
   SET inversionista_id = :destino
 WHERE liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq)
   AND inversionista_id = :origen;

-- Verificación ----------------------------------------------------------------
\echo ''
\echo '--- POST: la liquidación movida y sus enlaces (todo debe decir destino) ---'
SELECT l.liquidacion_id, l.inversionista_id AS inv_liquidacion,
       b.inversionista_id AS inv_boleta,
       (SELECT count(*) FROM cartera.pagos_credito_inversionistas p
         WHERE p.liquidacion_id = l.liquidacion_id AND p.inversionista_id = :destino) AS pagos_norm_destino,
       (SELECT count(*) FROM cartera.pagos_credito_inversionistas_espejo p
         WHERE p.liquidacion_id = l.liquidacion_id AND p.inversionista_id = :destino) AS pagos_espejo_destino
FROM cartera.liquidaciones l
LEFT JOIN cartera.boletas_pago_inversionista b ON b.boleta_id = l.boleta_id
WHERE l.liquidacion_id IN (SELECT liquidacion_id FROM _ultima_liq);

COMMIT;

\echo ''
\echo '>>> ÚLTIMA LIQUIDACIÓN MOVIDA AL DESTINO. Backups en cartera.backup_traslado_* <<<'

\endif

-- ============================================================================
-- REVERSIÓN MANUAL (si algo sale mal después del COMMIT):
--
--   BEGIN;
--   UPDATE cartera.creditos_inversionistas ci
--      SET inversionista_id = b.inversionista_id
--     FROM cartera.backup_traslado_creditos_inversionistas b
--    WHERE ci.id = b.id;
--   -- ... repetir con las otras 3 tablas backup_traslado_* (join por id) ...
--   COMMIT;
-- ============================================================================
