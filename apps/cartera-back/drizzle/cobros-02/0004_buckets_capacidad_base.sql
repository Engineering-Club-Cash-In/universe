-- ============================================================================
-- COBROS-02 · Motor de Buckets — 0004_buckets_capacidad_base
-- ============================================================================
-- CB-018: dashboard de carga de cuentas por asesor y bucket. Agrega la
-- capacidad "base" de cuentas activas al pool `cartera.asesor_bucket`
-- (parametrizable por fila asesor+bucket, default 300 según el ticket).
--
-- Confirmado con el informador del ticket (CB-018): el techo de 300 es POR
-- ASESOR dentro de un bucket ("la cantidad que puede atender un asesor"), NO
-- un techo agregado del bucket completo. Por eso vive en `asesor_bucket`
-- (1 fila por (asesor_id, bucket)) y no en el catálogo `buckets` — cada
-- asesor puede tener su propio techo, incluso dentro del mismo bucket.
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente.
-- ============================================================================

ALTER TABLE cartera.asesor_bucket ADD COLUMN IF NOT EXISTS capacidad_base integer NOT NULL DEFAULT 300;
