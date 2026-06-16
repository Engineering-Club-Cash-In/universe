-- ============================================================================
-- traslado_creditos_maria_elena_a_boca_terra.sql
--
-- Traslada la PARTICIPACIÓN EN CRÉDITOS de un inversionista persona natural
-- (María Elena Roca) a su sociedad (Boca-Terra), manteniendo el historial de
-- liquidaciones y pagos YA LIQUIDADOS a nombre de la persona original.
--
-- El traslado corre ANTES del próximo corte de liquidación: los pagos espejo
-- que el origen tenga pendientes de liquidar se MUEVEN al destino, para que
-- la próxima liquidación se los pague a la sociedad.
--
-- SE MUEVEN (inversionista_id origen → destino):
--   1) cartera.creditos_inversionistas          → participación vigente
--   2) cartera.creditos_inversionistas_espejo   → participación espejo
--   3) cartera.historico_liquidaciones_espejo   → snapshots de monto aportado
--   4) cartera.historico_monto_aportado_espejo  → auditoría de cambios de monto
--   5) cartera.pagos_credito_inversionistas_espejo → SOLO las filas con
--      estado_liquidacion <> 'LIQUIDADO' (pendientes del próximo corte)
--   6) cartera.abonos_capital                   → SOLO las filas con
--      liquidado = false (pendientes; los liquidará el destino)
--
-- NO SE MUEVEN (quedan a nombre de María Elena):
--   - cartera.liquidaciones
--   - cartera.pagos_credito_inversionistas      (historial; la liquidación
--     corre sobre el espejo)
--   - cartera.pagos_credito_inversionistas_espejo con estado LIQUIDADO
--   - cartera.abonos_capital con liquidado = true
--   - cartera.boletas_pago_inversionista
--   - cartera.reinversiones
--   - cartera.compras_credito_inversionista (✋ BLOQUEA si hay pendientes)
--   - cartera.documentos_inversionista
--
-- EFECTO DE NEGOCIO: a partir del traslado, los NUEVOS pagos de esos créditos
-- se reparten a Boca-Terra (payments.ts lee creditos_inversionistas), y la
-- próxima liquidación —incluyendo los pagos espejo y abonos pendientes que
-- se trasladan— sale a nombre de Boca-Terra. Lo ya liquidado queda intacto
-- a nombre de María Elena.
--
-- SALVAGUARDAS:
--   1) BACKUP: copia las filas afectadas de las 6 tablas a tablas
--      cartera.backup_traslado_* antes de modificar (permite revertir).
--   2) ABORTA si el destino ya participa en alguno de los créditos del origen
--      (violaría los unique ux_credito_inversionista / _espejo; ese caso es
--      un MERGE de participaciones y debe decidirse aparte).
--   3) ABORTA si el origen tiene compras/reinversiones con status <> completado
--      (si se movieran a medias, la aceptación pierde el par
--      credito+inversionista y la operación queda atorada).
--   4) Todo corre en UNA transacción: o se mueve todo o nada.
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
--   - ORDEN OPERATIVO: 1) preview de este script (checks bloqueantes vacíos,
--     revisar cuántos pagos espejo pendientes viajan) → 2) apply=1 ANTES del
--     corte de liquidación → 3) la próxima liquidación de esos créditos sale
--     a nombre de Boca-Terra, incluyendo los pagos pendientes trasladados.
--   - Los pagos NO_LIQUIDADO de la tabla normal (61 en dev al 2026-06-09)
--     quedan con el origen: son historial, la liquidación corre sobre el
--     espejo. No bloquean ni se mueven.
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

\echo '--- Compras/reinversiones del origen pendientes (BLOQUEA) ---'
SELECT id, credito_id, tipo_operacion, status, monto_aportado, fecha
FROM cartera.compras_credito_inversionista
WHERE inversionista_id = :origen AND status <> 'completado';

\echo ''
\echo '============================================================'
\echo ' SE MUEVEN TAMBIÉN: pendientes de liquidar del origen'
\echo ' (el traslado corre ANTES del corte; los liquidará el destino)'
\echo '============================================================'

\echo '--- Pagos espejo sin liquidar (SE MUEVEN) ---'
SELECT estado_liquidacion, count(*) AS filas, sum(cuota) AS total_cuota,
       count(DISTINCT credito_id) AS creditos
FROM cartera.pagos_credito_inversionistas_espejo
WHERE inversionista_id = :origen AND estado_liquidacion <> 'LIQUIDADO'
GROUP BY estado_liquidacion;

\echo '--- Abonos a capital sin liquidar (SE MUEVEN) ---'
SELECT abono_id, credito_id, monto, tipo, created_at
FROM cartera.abonos_capital
WHERE inversionista_id = :origen AND liquidado = false;

\echo ''
\echo '============================================================'
\echo ' WARNINGS (no bloquean)'
\echo '============================================================'
\echo '--- Pagos NORMAL sin liquidar (quedan con el origen; la liquidación corre sobre el espejo) ---'
SELECT estado_liquidacion, count(*) AS filas, sum(cuota) AS total_cuota
FROM cartera.pagos_credito_inversionistas
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

  -- NOTA: los pagos del ESPEJO con estado_liquidacion <> 'LIQUIDADO' y los
  -- abonos a capital con liquidado = false NO bloquean: se TRASLADAN al
  -- destino junto con la participación (el traslado corre ANTES de la
  -- liquidación, y esos pendientes los liquidará el destino). Lo ya liquidado
  -- y los pagos de la tabla normal quedan con el origen (solo historial).
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
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_pagos_inv_espejo
  (LIKE cartera.pagos_credito_inversionistas_espejo, fecha_backup timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS cartera.backup_traslado_abonos_capital
  (LIKE cartera.abonos_capital, fecha_backup timestamptz DEFAULT now());

INSERT INTO cartera.backup_traslado_creditos_inversionistas
  SELECT *, now() FROM cartera.creditos_inversionistas WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_creditos_inv_espejo
  SELECT *, now() FROM cartera.creditos_inversionistas_espejo WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_historico_liq_espejo
  SELECT *, now() FROM cartera.historico_liquidaciones_espejo WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_historico_monto_espejo
  SELECT *, now() FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :origen;
INSERT INTO cartera.backup_traslado_pagos_inv_espejo
  SELECT *, now() FROM cartera.pagos_credito_inversionistas_espejo
  WHERE inversionista_id = :origen AND estado_liquidacion <> 'LIQUIDADO';
INSERT INTO cartera.backup_traslado_abonos_capital
  SELECT *, now() FROM cartera.abonos_capital
  WHERE inversionista_id = :origen AND liquidado = false;

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

-- Pagos espejo pendientes de liquidar: pasan al destino para que su próxima
-- liquidación se los pague a la sociedad (el traslado corre ANTES del corte).
-- Los ya LIQUIDADO quedan con el origen como historial.
UPDATE cartera.pagos_credito_inversionistas_espejo
   SET inversionista_id = :destino,
       updated_at = now()
 WHERE inversionista_id = :origen
   AND estado_liquidacion <> 'LIQUIDADO';

-- Abonos a capital pendientes de liquidar: igual que los pagos espejo, pasan
-- al destino (la liquidación los busca por el inversionista vigente del
-- crédito, que tras el traslado es el destino). Los liquidados no se tocan.
UPDATE cartera.abonos_capital
   SET inversionista_id = :destino,
       updated_at = now()
 WHERE inversionista_id = :origen
   AND liquidado = false;

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
FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :origen
UNION ALL
SELECT 'pagos_espejo_sin_liquidar', count(*)
FROM cartera.pagos_credito_inversionistas_espejo
WHERE inversionista_id = :origen AND estado_liquidacion <> 'LIQUIDADO'
UNION ALL
SELECT 'abonos_capital_sin_liquidar', count(*)
FROM cartera.abonos_capital
WHERE inversionista_id = :origen AND liquidado = false;

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
FROM cartera.historico_monto_aportado_espejo WHERE inversionista_id = :destino
UNION ALL
SELECT 'pagos_espejo_sin_liquidar', count(*)
FROM cartera.pagos_credito_inversionistas_espejo
WHERE inversionista_id = :destino AND estado_liquidacion <> 'LIQUIDADO'
UNION ALL
SELECT 'abonos_capital_sin_liquidar', count(*)
FROM cartera.abonos_capital
WHERE inversionista_id = :destino AND liquidado = false;

\echo ''
\echo '--- Lo que NO se movió (debe seguir a nombre del origen, solo historial) ---'
SELECT 'liquidaciones' AS tabla, count(*) AS filas
FROM cartera.liquidaciones WHERE inversionista_id = :origen
UNION ALL
SELECT 'pagos_credito_inversionistas', count(*)
FROM cartera.pagos_credito_inversionistas WHERE inversionista_id = :origen
UNION ALL
SELECT 'pagos_espejo_LIQUIDADOS (historial)', count(*)
FROM cartera.pagos_credito_inversionistas_espejo
WHERE inversionista_id = :origen AND estado_liquidacion = 'LIQUIDADO';

COMMIT;

\echo ''
\echo '>>> TRASLADO COMPLETADO. Backups en cartera.backup_traslado_* <<<'

\else

\echo ''
\echo '>>> MODO PREVIEW: no se modificó nada. Usar -v apply=1 para aplicar. <<<'

\endif

-- ============================================================================
-- REVERSIÓN MANUAL (si algo sale mal después del COMMIT):
--
--   BEGIN;
--   UPDATE cartera.creditos_inversionistas ci
--      SET inversionista_id = b.inversionista_id
--     FROM cartera.backup_traslado_creditos_inversionistas b
--    WHERE ci.id = b.id;
--   -- ... repetir con las otras 5 tablas backup_traslado_* (join por id;
--   --     en abonos_capital el id es abono_id) ...
--   COMMIT;
-- ============================================================================
