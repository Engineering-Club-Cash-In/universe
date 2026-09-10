-- =====================================================================
-- COBROS-02 · Asignación inicial — PASO 1/3: pool asesor ↔ bucket
-- =====================================================================
-- Corre DESPUÉS de las migraciones 0000→0003 (necesita `buckets` y
-- `asesor_bucket`). Idempotente y AUTORITATIVO: el pool queda EXACTAMENTE
-- como dice el CSV — los pares (asesor, bucket) que no estén en el archivo
-- se desactivan (activo=false, no se borran: conservan capacidad y margen).
--
-- Parámetros (variables de psql):
--   -v schema=cartera_cobros2      schema destino (default: cartera_cobros2)
--   -v pool_csv=asignacion/pool.csv ruta al CSV (default: pool.csv junto a este archivo)
--
-- Formato del CSV (con cabecera):
--   email_cash_in,buckets,nombre_referencia
--   octavio.r@clubcashin.com,1|2,Octavio Rosales
--
--   · La LLAVE es email_cash_in: es el puente asesor(cartera) ↔ usuario(CRM)
--     que usan la cola, la agenda y las alertas. Los nombres e ids cambiaron de
--     persona entre refrescos (ver runbook 2026-08-17); el correo no.
--   · `buckets` admite varios separados por "|" (un asesor puede cubrir B1 y B2).
--   · `nombre_referencia` es informativo: si difiere del nombre en la base se
--     avisa con NOTICE pero no frena.
--
-- Guards (revientan, no asignan a medias): correo inexistente o inactivo,
-- bucket fuera del catálogo, y bucket del catálogo activo sin ningún asesor.
--
-- Uso a mano:  psql "$URL" -v schema=cartera_cobros2 -v pool_csv=pool.csv -f 01_pool_asesor_bucket.sql
-- Orquestado:  carga_inicial.sh (misma carpeta) lo llama con --pool.
-- =====================================================================

\if :{?schema}
\else
\set schema cartera_cobros2
\endif
\if :{?pool_csv}
\else
\set pool_csv pool.csv
\endif

BEGIN;

SET LOCAL search_path TO :"schema";

-- 1) Cargar el CSV tal cual.
CREATE TEMP TABLE tmp_pool_csv (
  email_cash_in     text,
  buckets           text,
  nombre_referencia text
) ON COMMIT DROP;

-- \copy es la única meta-orden de psql que NO interpola variables: se arma la
-- orden en una variable y se ejecuta (truco documentado de psql).
\set copiar_csv '\\copy tmp_pool_csv FROM ' :'pool_csv' ' WITH (FORMAT csv, HEADER true)'
:copiar_csv

-- 2) Expandir "1|2" a una fila por (correo, bucket).
CREATE TEMP TABLE tmp_pool ON COMMIT DROP AS
SELECT lower(trim(p.email_cash_in)) AS email_cash_in,
       trim(b)::int                  AS bucket,
       trim(p.nombre_referencia)     AS nombre_referencia
FROM tmp_pool_csv p,
     LATERAL regexp_split_to_table(p.buckets, '\|') AS b
WHERE trim(coalesce(p.email_cash_in, '')) <> '';

-- 3) Guards.
DO $$
DECLARE faltan text; ambiguos text; malos text; sin_asesor text; r record;
BEGIN
  IF (SELECT count(*) FROM tmp_pool) = 0 THEN
    RAISE EXCEPTION 'El CSV del pool está vacío';
  END IF;

  SELECT string_agg(DISTINCT t.email_cash_in, ', ') INTO faltan
  FROM tmp_pool t
  LEFT JOIN asesores a ON lower(a.email_cash_in) = t.email_cash_in AND a.activo
  WHERE a.asesor_id IS NULL;
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Correos sin asesor ACTIVO en asesores.email_cash_in: %', faltan;
  END IF;

  -- Dos asesores ACTIVOS con el mismo correo es ambiguo: elegir uno al azar
  -- le entrega la cartera de un bucket a quien no toca. Se rechaza.
  SELECT string_agg(x.correo || ' (' || x.n || ' asesores activos)', ', ') INTO ambiguos
  FROM (
    SELECT t.email_cash_in AS correo, count(*) AS n
    FROM (SELECT DISTINCT email_cash_in FROM tmp_pool) t
    JOIN asesores a ON lower(a.email_cash_in) = t.email_cash_in AND a.activo
    GROUP BY t.email_cash_in HAVING count(*) > 1
  ) x;
  IF ambiguos IS NOT NULL THEN
    RAISE EXCEPTION 'Correos con más de un asesor activo en asesores: %. Resolvé el duplicado antes de armar el pool.', ambiguos;
  END IF;

  SELECT string_agg(DISTINCT t.bucket::text, ', ') INTO malos
  FROM tmp_pool t
  LEFT JOIN buckets b ON b.numero = t.bucket AND b.activo
  WHERE b.numero IS NULL;
  IF malos IS NOT NULL THEN
    RAISE EXCEPTION 'Buckets que no existen (o inactivos) en el catálogo: %', malos;
  END IF;

  SELECT string_agg('B' || b.numero, ', ') INTO sin_asesor
  FROM buckets b
  WHERE b.activo
    AND NOT EXISTS (SELECT 1 FROM tmp_pool t WHERE t.bucket = b.numero);
  IF sin_asesor IS NOT NULL THEN
    RAISE EXCEPTION 'Buckets del catálogo sin ningún asesor en el CSV: % — el paso 02 dejaría créditos sin dueño', sin_asesor;
  END IF;

  FOR r IN
    SELECT DISTINCT t.email_cash_in, t.nombre_referencia, a.nombre AS nombre_db
    FROM tmp_pool t JOIN asesores a ON lower(a.email_cash_in) = t.email_cash_in
    WHERE t.nombre_referencia IS NOT NULL AND t.nombre_referencia <> '' AND t.nombre_referencia <> a.nombre
  LOOP
    RAISE NOTICE 'OJO: % en el CSV dice "%" pero en la base se llama "%"', r.email_cash_in, r.nombre_referencia, r.nombre_db;
  END LOOP;
END $$;

-- 4) Alta/reactivación de los pares del CSV (conserva capacidad y margen si ya existían).
-- `a.activo` va en el JOIN, no solo en el guard: `email_cash_in` no es único,
-- y con dos filas del mismo correo (una activa y otra dada de baja) el guard
-- se conformaba con encontrar la activa mientras esto insertaba LAS DOS con
-- activo=true. El motor solo mira `asesor_bucket.activo`, así que le habría
-- caído cartera a la fila muerta (review de Codex, P1).
INSERT INTO asesor_bucket (asesor_id, bucket, activo)
SELECT a.asesor_id, t.bucket, true
FROM tmp_pool t
JOIN asesores a ON lower(a.email_cash_in) = t.email_cash_in AND a.activo
ON CONFLICT (asesor_id, bucket) DO UPDATE
  SET activo = true, updated_at = now()
  WHERE asesor_bucket.activo IS DISTINCT FROM true;

-- 5) Baja de los pares que YA NO están en el CSV (autoritativo).
UPDATE asesor_bucket ab
   SET activo = false, updated_at = now()
 WHERE ab.activo
   AND NOT EXISTS (
     SELECT 1 FROM tmp_pool t
     JOIN asesores a ON lower(a.email_cash_in) = t.email_cash_in AND a.activo
     WHERE a.asesor_id = ab.asesor_id AND t.bucket = ab.bucket
   );

-- Resumen: pool resultante (solo activos).
SELECT ab.bucket, b.prefijo, b.nombre AS bucket_nombre,
       a.asesor_id, a.nombre AS asesor, a.email_cash_in,
       ab.capacidad_base
FROM asesor_bucket ab
JOIN buckets b  ON b.numero = ab.bucket
JOIN asesores a ON a.asesor_id = ab.asesor_id
WHERE ab.activo
ORDER BY ab.bucket, a.nombre;

-- Resumen: pares desactivados por esta corrida (quedaron fuera del CSV).
SELECT a.nombre AS asesor, 'B' || ab.bucket AS bucket_desactivado
FROM asesor_bucket ab
JOIN asesores a ON a.asesor_id = ab.asesor_id
WHERE NOT ab.activo AND ab.updated_at >= now() - interval '1 minute'
ORDER BY a.nombre, ab.bucket;

COMMIT;
