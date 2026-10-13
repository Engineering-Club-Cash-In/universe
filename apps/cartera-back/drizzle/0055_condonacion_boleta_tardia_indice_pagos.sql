-- Boleta tardía: índice parcial sobre pagos_credito.boleta_tardia_intento_id.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Paso MANUAL en PROD, ANTES del código y fuera de transacción (psql -f, sin
-- BEGIN): CREATE INDEX CONCURRENTLY no corre dentro de un bloque de transacción,
-- y se usa porque pagos_credito es grande (~170 k filas) y está viva.
-- Si falla a medias deja un índice INVALID: hacer
--   DROP INDEX CONCURRENTLY cartera.pagos_credito_idx_boleta_tardia_intento;
-- antes de reintentar. Verificar `indisvalid = true` en pg_index es OBLIGATORIO:
-- IF NOT EXISTS no repara un índice INVALID (hay que DROP INDEX CONCURRENTLY y recrear).
-- Es opcional para el funcionamiento (sin él, la
-- idempotencia y el barrido harían scan secuencial) pero necesario para el rendimiento.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pagos_credito_idx_boleta_tardia_intento
  ON cartera.pagos_credito (boleta_tardia_intento_id)
  WHERE boleta_tardia_intento_id IS NOT NULL;
