-- =====================================================================
-- COBROS-02 · Asignación inicial — PASO 1/3: pool asesor ↔ bucket
-- =====================================================================
-- Corre DESPUÉS de las migraciones 0000→0003 (necesita `buckets` y
-- `asesor_bucket`). Idempotente: se puede re-correr sin duplicar.
--
-- Distribución acordada (2026-07-08, Daniel):
--   B0 Cartera Sana                  → Caren Rivera
--   B1 Alerta Temprana               → Diego Gomez + Asesor Prueba B1 (nuevo,
--                                      para probar bucket con >1 asesor)
--   B2 Gestión Activa                → Samuel Gamboa
--   B3 Rescate                       → Jorge Sente
--   B4 Última Instancia/Pre Jurídico → Erik Rivas
--   B5 Jurídico                      → Gerencia
--
-- El mapeo va POR NOMBRE (no por id) para que sirva igual en el sandbox,
-- en dev o en prod; si un nombre no existe, el script REVIENTA (no asigna
-- a medias en silencio).
-- =====================================================================

BEGIN;

-- ⇦ Sandbox de pruebas. Cambiar a `cartera` cuando toque el ambiente real.
SET LOCAL search_path TO cartera_cobros2;

-- 1) Asesor nuevo de prueba para B1. activo_para_creditos = false para que
--    NO entre al balanceo viejo de ORIGINACIÓN (getAsesorConMenorCarga);
--    el reparto de COBROS lo maneja asesor_bucket, no ese flag.
INSERT INTO asesores (nombre, activo, activo_para_creditos)
SELECT 'Asesor Prueba B1', true, false
WHERE NOT EXISTS (
  SELECT 1 FROM asesores WHERE nombre = 'Asesor Prueba B1'
);

-- 2) Guard: todos los nombres del mapeo deben existir antes de armar el pool.
DO $$
DECLARE faltan text;
BEGIN
  SELECT string_agg(m.nombre, ', ') INTO faltan
  FROM (VALUES
    ('Caren Rivera'), ('Diego Gomez'), ('Asesor Prueba B1'),
    ('Samuel Gamboa'), ('Jorge Sente'), ('Erik Rivas'), ('Gerencia')
  ) AS m(nombre)
  LEFT JOIN asesores a ON a.nombre = m.nombre
  WHERE a.asesor_id IS NULL;

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Asesores no encontrados en cartera.asesores: %', faltan;
  END IF;
END $$;

-- 3) Pool: elegibilidad asesor↔bucket (NO es la asignación del crédito;
--    esa vive en creditos.asesor_id y la hace el paso 2).
INSERT INTO asesor_bucket (asesor_id, bucket)
SELECT a.asesor_id, m.bucket
FROM (VALUES
  ('Caren Rivera',     0),
  ('Diego Gomez',      1),
  ('Asesor Prueba B1', 1),
  ('Samuel Gamboa',    2),
  ('Jorge Sente',      3),
  ('Erik Rivas',       4),
  ('Gerencia',         5)
) AS m(nombre, bucket)
JOIN asesores a ON a.nombre = m.nombre
ON CONFLICT (asesor_id, bucket) DO NOTHING;

-- Resumen: pool resultante
SELECT ab.bucket, b.prefijo, b.nombre AS bucket_nombre,
       a.nombre AS asesor, ab.activo
FROM asesor_bucket ab
JOIN buckets b  ON b.numero = ab.bucket
JOIN asesores a ON a.asesor_id = ab.asesor_id
ORDER BY ab.bucket, a.nombre;

COMMIT;
