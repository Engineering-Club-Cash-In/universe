-- ============================================================================
-- COBROS-02 · Motor de Buckets — 0003_buckets_estado_mora
-- ============================================================================
-- Puente numero ↔ estadoMora: agrega la columna `estado_mora` al catálogo
-- `cartera.buckets` para que sea la fuente única (antes vivía duplicada en
-- código: cartera-back/src/config/moraBuckets.ts y crm moraBuckets.ts).
--
-- Cubre SOLO los 6 buckets de aging (B0-B5 = al_dia..mora_120_plus). Estados
-- como pagado/incobrable/en_convenio/completado NO son filas del catálogo y
-- siguen resueltos por status en código (mapearEstadoMora en CRM).
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente.
-- Se aplica DESPUÉS de 0001_buckets_catalogo.sql.
-- ============================================================================

ALTER TABLE cartera.buckets ADD COLUMN IF NOT EXISTS estado_mora varchar(24);
--> statement-breakpoint

UPDATE cartera.buckets SET estado_mora = 'al_dia' WHERE numero = 0;
--> statement-breakpoint
UPDATE cartera.buckets SET estado_mora = 'mora_30' WHERE numero = 1;
--> statement-breakpoint
UPDATE cartera.buckets SET estado_mora = 'mora_60' WHERE numero = 2;
--> statement-breakpoint
UPDATE cartera.buckets SET estado_mora = 'mora_90' WHERE numero = 3;
--> statement-breakpoint
UPDATE cartera.buckets SET estado_mora = 'mora_120' WHERE numero = 4;
--> statement-breakpoint
UPDATE cartera.buckets SET estado_mora = 'mora_120_plus' WHERE numero = 5;
