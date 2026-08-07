-- ============================================================================
-- Re-basa historico_liquidaciones_espejo de AUTOCASH S.A. (inversionista 89)
-- ============================================================================
--
-- Para qué: /calcularPagosEspejo compara creditos_inversionistas_espejo.monto_aportado
-- contra el ÚLTIMO snapshot de historico_liquidaciones_espejo. Ese snapshot solo lo
-- escribe la liquidación, y Autocash nunca se liquidó, así que quedó viejo — y encima
-- el 2026-08-06 se le movió el espejo con el cuadre autorizado por conta. Resultado:
-- [MONTO_ESPEJO_INCONSISTENTE] al calcular pagos.
--
-- Qué hace: inserta un snapshot NUEVO con el valor actual del espejo. No toca el espejo,
-- ni el padre, ni el capital. El histórico solo valida — la base del interés sale del
-- espejo — así que esto NO mueve plata.
--
-- Ojo:
--   · Comparación EXACTA (<>), sin tolerancia: el código valida con .eq() y una
--     milésima de diferencia igual tumba el cálculo.
--   · Solo créditos que YA tienen histórico. Si no hay snapshot, la validación se
--     salta sola y no hay que crear uno.
--   · liquidacion_id = NULL → es una foto de referencia, no una liquidación.
--   · Si Autocash tuviera liquidaciones esto NO sería inocuo. Verificar primero
--     que siga en 0 (paso 0).
--
-- Equivalente al script:
--   bun run src/scripts/espejo/alinearEspejoHistorico.ts --inversionista=89 --sin-alinear --apply --permitir-prod
-- ============================================================================

-- ── Paso 0: reja de seguridad — tiene que dar 0 ─────────────────────────────
SELECT count(*) AS liquidaciones_autocash
FROM cartera.liquidaciones
WHERE inversionista_id = 89;


-- ── Paso 1: PREVIEW — qué se va a insertar ──────────────────────────────────
WITH ultimo AS (
  SELECT DISTINCT ON (h.credito_id)
         h.credito_id,
         h.monto_aportado AS historico,
         h.fecha          AS historico_fecha
  FROM cartera.historico_liquidaciones_espejo h
  WHERE h.inversionista_id = 89
  ORDER BY h.credito_id, h.fecha DESC
)
SELECT c.numero_credito_sifco                    AS sifco,
       c."statusCredit"                          AS status,
       u.historico::numeric(18,2)                AS historico_actual,
       e.monto_aportado::numeric(18,2)           AS espejo_actual,
       (e.monto_aportado - u.historico)::numeric(18,2) AS diferencia,
       u.historico_fecha::date                   AS historico_desde
FROM cartera.creditos_inversionistas_espejo e
JOIN cartera.creditos c  ON c.credito_id = e.credito_id
JOIN ultimo u            ON u.credito_id = e.credito_id
WHERE e.inversionista_id = 89
  AND c."statusCredit" IN ('ACTIVO', 'MOROSO', 'PENDIENTE_CANCELACION',
                           'EN_CONVENIO', 'CANCELADO', 'INCOBRABLE')
  AND e.monto_aportado <> u.historico
ORDER BY c.numero_credito_sifco;


-- ── Paso 2: INSERT ──────────────────────────────────────────────────────────
-- Correr dentro de la transacción, revisar el rowcount contra el preview, y recién
-- ahí COMMIT. Si no cuadra: ROLLBACK.
BEGIN;

WITH ultimo AS (
  SELECT DISTINCT ON (h.credito_id)
         h.credito_id,
         h.monto_aportado AS historico
  FROM cartera.historico_liquidaciones_espejo h
  WHERE h.inversionista_id = 89
  ORDER BY h.credito_id, h.fecha DESC
)
INSERT INTO cartera.historico_liquidaciones_espejo
       (monto_aportado, inversionista_id, credito_id, liquidacion_id, fecha)
SELECT e.monto_aportado,
       89,
       e.credito_id,
       NULL,
       now()
FROM cartera.creditos_inversionistas_espejo e
JOIN cartera.creditos c ON c.credito_id = e.credito_id
JOIN ultimo u           ON u.credito_id = e.credito_id
WHERE e.inversionista_id = 89
  AND c."statusCredit" IN ('ACTIVO', 'MOROSO', 'PENDIENTE_CANCELACION',
                           'EN_CONVENIO', 'CANCELADO', 'INCOBRABLE')
  AND e.monto_aportado <> u.historico;

-- COMMIT;
-- ROLLBACK;


-- ── Paso 3: verificar — tiene que dar 0 filas ───────────────────────────────
WITH ultimo AS (
  SELECT DISTINCT ON (h.credito_id)
         h.credito_id, h.monto_aportado AS historico
  FROM cartera.historico_liquidaciones_espejo h
  WHERE h.inversionista_id = 89
  ORDER BY h.credito_id, h.fecha DESC
)
SELECT c.numero_credito_sifco AS sifco_pendiente
FROM cartera.creditos_inversionistas_espejo e
JOIN cartera.creditos c ON c.credito_id = e.credito_id
JOIN ultimo u           ON u.credito_id = e.credito_id
WHERE e.inversionista_id = 89
  AND c."statusCredit" IN ('ACTIVO', 'MOROSO', 'PENDIENTE_CANCELACION',
                           'EN_CONVENIO', 'CANCELADO', 'INCOBRABLE')
  AND e.monto_aportado <> u.historico;


-- ── Rollback, si hiciera falta después del COMMIT ───────────────────────────
-- Los snapshots que mete este script son los únicos de Autocash con
-- liquidacion_id NULL y fecha de hoy:
--
--   DELETE FROM cartera.historico_liquidaciones_espejo
--   WHERE inversionista_id = 89
--     AND liquidacion_id IS NULL
--     AND fecha >= date_trunc('day', now());
