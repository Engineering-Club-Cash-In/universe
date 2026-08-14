-- 0033b: CB-128 — Índices de escala sobre contactos_cobros.
--
-- ⚠️ NO EJECUTAR ESTE ARCHIVO DENTRO DE UNA TRANSACCIÓN.
--    Nada de `psql -1` / `--single-transaction`, nada de envolverlo en
--    BEGIN/COMMIT. Postgres PROHÍBE CREATE INDEX CONCURRENTLY dentro de una
--    transacción y el archivo entero falla.
--
--    Con `psql -f 0033b_...sql` (sin -1) cada statement va en autocommit y
--    funciona tal cual. Correr DESPUÉS de 0033a, que crea bucket_snapshot.
--
-- Por qué CONCURRENTLY: contactos_cobros es el camino caliente del módulo
-- (cada gestión registrada desde la Ficha 360, el panel de gestión rápida, el
-- contacto-modal y los envíos masivos escribe acá). Un CREATE INDEX normal toma
-- lock de escritura sobre la tabla: en dev con ~3k filas es instantáneo y da
-- igual, pero en producción con cientos de miles bloquea a los asesores
-- mientras dure.
--
-- Por qué hacen falta: contactos_cobros tenía UN solo índice, (caso_cobro_id,
-- fecha_contacto), que sirve a la Ficha 360 (un caso a la vez) pero no a esta
-- feature, que filtra por rango de fechas GLOBAL. El negocio proyecta 5× los
-- créditos actuales a 5 años (~1,772 → ~8,900), lo que lleva esta tabla a
-- ~500k-800k filas: ahí un seq scan por carga de la vista deja de ser viable.
--
-- CONCURRENTLY no es idempotente vía IF NOT EXISTS de forma limpia: si uno
-- falla a medias deja un índice INVÁLIDO. Verificar al terminar con:
--   SELECT indexrelid::regclass, indisvalid
--   FROM pg_index WHERE NOT indisvalid;
-- y hacer DROP INDEX del inválido antes de reintentar ese statement.

-- Query principal del historial: rango de fechas, orden descendente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contactos_cobros_fecha
  ON public.contactos_cobros (fecha_contacto DESC);

-- Scoping del asesor (AC-3): su propio historial por fecha. Compuesto porque
-- el filtro por usuario y el orden por fecha van SIEMPRE juntos en esa vista.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contactos_cobros_realizado_fecha
  ON public.contactos_cobros (realizado_por, fecha_contacto DESC);

-- Segmentación por bucket (el corazón del AC del ticket). Parcial: cubre el
-- filtro por bucket NUMÉRICO, que es el que se beneficia de un índice.
--
-- El chip "Sin bucket" (bucket_snapshot IS NULL) queda deliberadamente FUERA:
-- indexar esas filas duplicaría el peso del índice para servir un predicado que
-- ya resuelve bien idx_contactos_cobros_fecha — el rango de fechas acota primero
-- y NULL es un grupo grande, no selectivo, así que un índice sobre él no ayuda.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contactos_cobros_bucket_fecha
  ON public.contactos_cobros (bucket_snapshot, fecha_contacto DESC)
  WHERE bucket_snapshot IS NOT NULL;
