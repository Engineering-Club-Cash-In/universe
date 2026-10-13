-- Boleta pagada a tiempo y registrada tarde: valor nuevo del origen de eventos de mora.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Paso MANUAL en PROD, ANTES del código y fuera de transacción (igual que 0051):
--   psql -f 0053_condonacion_boleta_tardia_enum.sql
-- ⚠️ `ALTER TYPE … ADD VALUE` NO puede usarse dentro de la misma transacción
-- que lo crea: NO envolver en BEGIN/COMMIT. Orden: 0053 → 0054 → 0055 → código.
ALTER TYPE cartera.mora_evento_origen ADD VALUE IF NOT EXISTS 'CONDONACION_BOLETA_TARDIA';
