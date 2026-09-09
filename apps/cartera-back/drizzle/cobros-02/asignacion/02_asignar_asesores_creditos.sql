-- =====================================================================
-- COBROS-02 · Asignación inicial — PASO 2/3: crédito → asesor de su bucket
-- =====================================================================
-- Requiere el PASO 1 (pool en asesor_bucket). Todo SET-BASED: se deriva el
-- bucket de cada crédito con las MISMAS reglas del motor (bucketDeCredito
-- en latefee.ts) usando la mora activa, y se reparte por bucket:
--   · bucket con 1 asesor  → asignación directa
--   · bucket con N asesores → round-robin determinístico (parejo, ordenado
--     por credito_id, asesores ordenados por asesor_id)
--
-- Reglas de derivación (idénticas al motor):
--   1. statusCredit fuera del funnel (CANCELADO, PENDIENTE_CANCELACION,
--      EN_CONVENIO, CAIDO) → NO se toca el crédito.
--   2. statusCredit en buckets.estados_incluidos (INCOBRABLE → B5) manda.
--   3. Si no, cuotas_atrasadas de la mora ACTIVA contra los rangos del
--      catálogo (sin mora activa = 0 → B0; cuotas_max NULL = abierto).
--
-- ⚠️ DECISIÓN DE RAÍZ: el UPDATE toca ÚNICAMENTE creditos.asesor_id.
--    Nada más del crédito se modifica. Bitácora SIEMPRE (append-only).
-- Idempotente: re-correrlo con la misma data no duplica bitácora ni
-- re-actualiza (el round-robin es determinístico y los no-cambios se filtran).
-- =====================================================================

-- Schema destino por variable de psql: -v schema=cartera_cobros2 (default: cartera_cobros2).
-- Lo pasa carga_inicial.sh; a mano, psql -v schema=... -f este_archivo.
\if :{?schema}
\else
\set schema cartera_cobros2
\endif
-- Modo de reparto: -v conservar=1 (alineación desde prod) deja en su lugar al crédito
-- cuyo dueño actual YA es elegible en el pool de su bucket y solo reparte los
-- huérfanos, empezando por el asesor con menos carga (mismo criterio que
-- elegirAsesorParaBucket en el motor). Default 0 = carga inicial: round-robin
-- puro sobre el pool, como siempre.
\if :{?conservar}
\else
\set conservar 0
\endif

BEGIN;

SET LOCAL search_path TO :"schema";

-- 1) Derivar bucket por crédito (misma derivación que 03_linea_base).
CREATE TEMP TABLE tmp_bucket ON COMMIT DROP AS
SELECT
  c.credito_id,
  c.asesor_id AS asesor_actual,
  COALESCE(
    -- prioridad 1: estados incluidos explícitos del catálogo (INCOBRABLE → B5)
    (SELECT b.numero FROM buckets b
      WHERE b.activo AND c."statusCredit" = ANY (b.estados_incluidos)
      ORDER BY b.numero LIMIT 1),
    -- prioridad 2: rango de cuotas atrasadas del catálogo
    (SELECT b.numero FROM buckets b
      WHERE b.activo
        AND COALESCE(m.cuotas_atrasadas, 0) >= b.cuotas_min
        AND (b.cuotas_max IS NULL OR COALESCE(m.cuotas_atrasadas, 0) <= b.cuotas_max)
      ORDER BY b.numero LIMIT 1)
  ) AS bucket
FROM creditos c
LEFT JOIN moras_credito m ON m.credito_id = c.credito_id AND m.activa = true
WHERE c."statusCredit" NOT IN
  ('CANCELADO', 'PENDIENTE_CANCELACION', 'EN_CONVENIO', 'CAIDO');

-- 2) Guard: ningún bucket con créditos puede quedarse sin asesores en el pool
--    (mejor reventar que dejar créditos sin dueño en silencio).
DO $$
DECLARE sin_pool text;
BEGIN
  SELECT string_agg(DISTINCT t.bucket::text, ', ') INTO sin_pool
  FROM tmp_bucket t
  WHERE t.bucket IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM asesor_bucket ab
      WHERE ab.activo AND ab.bucket = t.bucket
    );

  IF sin_pool IS NOT NULL THEN
    RAISE EXCEPTION 'Buckets con créditos pero sin asesor en el pool: % — correr 01_pool_asesor_bucket.sql primero', sin_pool;
  END IF;
END $$;

-- 3) Repartir.
--    conservar=0: round-robin determinístico sobre el pool del bucket (1 asesor
--    → directo; N → parejo, ordenado por credito_id y asesor_id).
--    conservar=1: los créditos cuyo dueño ya está en el pool de su bucket se
--    quedan; solo los huérfanos entran al round-robin, y el orden de los
--    asesores es por carga conservada ascendente (empate: menor asesor_id).
--    Con conservar=0 la carga conservada es 0 para todos → mismo orden de antes.
CREATE TEMP TABLE tmp_pool_bucket ON COMMIT DROP AS
SELECT ab.bucket, ab.asesor_id FROM asesor_bucket ab WHERE ab.activo;

CREATE TEMP TABLE tmp_conservados ON COMMIT DROP AS
SELECT t.credito_id, t.asesor_actual, t.bucket, t.asesor_actual AS asesor_nuevo
FROM tmp_bucket t
WHERE :conservar::int = 1
  AND t.bucket IS NOT NULL
  AND EXISTS (SELECT 1 FROM tmp_pool_bucket p
               WHERE p.bucket = t.bucket AND p.asesor_id = t.asesor_actual);

CREATE TEMP TABLE tmp_asignacion ON COMMIT DROP AS
WITH carga AS (
  SELECT bucket, asesor_nuevo AS asesor_id, count(*) AS n
  FROM tmp_conservados GROUP BY 1, 2
),
pool AS (
  SELECT p.bucket,
         array_agg(p.asesor_id ORDER BY COALESCE(c.n, 0), p.asesor_id) AS asesores
  FROM tmp_pool_bucket p
  LEFT JOIN carga c ON c.bucket = p.bucket AND c.asesor_id = p.asesor_id
  GROUP BY p.bucket
),
huerfanos AS (
  SELECT t.credito_id, t.asesor_actual, t.bucket,
         row_number() OVER (PARTITION BY t.bucket ORDER BY t.credito_id) AS rn
  FROM tmp_bucket t
  WHERE t.bucket IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM tmp_conservados k WHERE k.credito_id = t.credito_id)
)
SELECT h.credito_id, h.asesor_actual, h.bucket,
       p.asesores[1 + ((h.rn - 1) % array_length(p.asesores, 1))::int] AS asesor_nuevo
FROM huerfanos h
JOIN pool p ON p.bucket = h.bucket
UNION ALL
SELECT credito_id, asesor_actual, bucket, asesor_nuevo FROM tmp_conservados;

-- 4) Bitácora PRIMERO (captura el asesor_anterior antes del UPDATE).
--    usuario_id NULL: es una carga masiva por script, no un supervisor.
INSERT INTO credito_asesor_historial
  (credito_id, asesor_anterior, asesor_nuevo, bucket, origen, motivo)
SELECT credito_id, asesor_actual, asesor_nuevo, bucket, 'API_MANUAL',
       CASE WHEN :conservar::int = 1
            THEN 'Reasignación por alineación — dueño fuera del pool de su bucket (SQL)'
            ELSE 'Asignación inicial por bucket — carga COBROS-02 (SQL)' END
FROM tmp_asignacion
WHERE asesor_actual IS DISTINCT FROM asesor_nuevo;

-- 5) UPDATE: ÚNICAMENTE asesor_id (decisión de raíz — nada más del crédito).
UPDATE creditos c
SET asesor_id = t.asesor_nuevo
FROM tmp_asignacion t
WHERE c.credito_id = t.credito_id
  AND c.asesor_id IS DISTINCT FROM t.asesor_nuevo;

-- Resumen: distribución final por bucket y asesor (B1 debe quedar ~50/50)
SELECT t.bucket, b.prefijo, a.nombre AS asesor, count(*) AS creditos
FROM tmp_asignacion t
JOIN buckets b  ON b.numero = t.bucket
JOIN asesores a ON a.asesor_id = t.asesor_nuevo
GROUP BY t.bucket, b.prefijo, a.nombre
ORDER BY t.bucket, a.nombre;

-- Resumen: cuántos créditos cambiaron de dueño
SELECT count(*) AS reasignados
FROM tmp_asignacion
WHERE asesor_actual IS DISTINCT FROM asesor_nuevo;

COMMIT;
