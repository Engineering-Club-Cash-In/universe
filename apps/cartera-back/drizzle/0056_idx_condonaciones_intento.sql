-- Boleta tardía: índice por (intento_id, credito_id) sobre moras_condonaciones, INCLUYENDO anuladas.
--
-- La insignia de contabilidad (listado de pagos) busca la condonación de cada pago por intento y crédito,
-- viva o anulada. uq_moras_condonaciones_intento_viva (0054) solo cubre las vivas y no sirve para esa consulta.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- 0053 (manual) -> 0054 -> 0055 (manual) -> 0056 -> código. Tabla chica: sin CONCURRENTLY, corre normal
-- (psql -v ON_ERROR_STOP=1 -f 0056_idx_condonaciones_intento.sql; sin ON_ERROR_STOP psql sale con 0 tras
-- un error). lock_timeout evita encolarse detrás de una transacción larga. Es idempotente. Sin él el código
-- funciona, pero cada pago con intento hace scan secuencial de moras_condonaciones.
-- Verificación:
--   SELECT indexrelid::regclass, indisvalid FROM pg_index
--   WHERE indexrelid = 'cartera.moras_condonaciones_idx_intento'::regclass;   -- indisvalid = true
SET lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS moras_condonaciones_idx_intento
  ON cartera.moras_condonaciones (intento_id, credito_id)
  WHERE intento_id IS NOT NULL;
