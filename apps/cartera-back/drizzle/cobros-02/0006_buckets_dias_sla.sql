-- ============================================================================
-- COBROS-02 · Motor de Buckets — 0006_buckets_dias_sla
-- ============================================================================
-- CB-020: días de SLA para contactar un crédito desde que ENTRÓ a su bucket
-- ACTUAL (fecha = última fila de buckets_historial para ese credito_id). Lo
-- consume la Cola del Día del CRM (GET /buckets/cola-dia) para calcular
-- fecha_limite_sla = fecha_entrada_bucket + dias_sla.
--
-- B0 (Cartera Sana) queda en NULL a propósito: al día, no aplica SLA de
-- contacto. Los valores de B1-B5 son PLACEHOLDER — Cartera/negocio debe
-- confirmar los días reales por bucket antes de que la Cola del Día salga a
-- producción; se pueden corregir con un UPDATE directo en cualquier momento
-- (mismo criterio que el resto de este catálogo: editable a mano por SQL).
--
-- NOTA: Cartera aplica el SQL a mano (no drizzle-kit). Idempotente.
-- Se aplica DESPUÉS de 0001_buckets_catalogo.sql.
-- ============================================================================

ALTER TABLE cartera.buckets ADD COLUMN IF NOT EXISTS dias_sla integer;
--> statement-breakpoint

UPDATE cartera.buckets SET dias_sla = 3 WHERE numero = 1 AND dias_sla IS NULL;
--> statement-breakpoint
UPDATE cartera.buckets SET dias_sla = 3 WHERE numero = 2 AND dias_sla IS NULL;
--> statement-breakpoint
UPDATE cartera.buckets SET dias_sla = 2 WHERE numero = 3 AND dias_sla IS NULL;
--> statement-breakpoint
UPDATE cartera.buckets SET dias_sla = 2 WHERE numero = 4 AND dias_sla IS NULL;
--> statement-breakpoint
UPDATE cartera.buckets SET dias_sla = 1 WHERE numero = 5 AND dias_sla IS NULL;
