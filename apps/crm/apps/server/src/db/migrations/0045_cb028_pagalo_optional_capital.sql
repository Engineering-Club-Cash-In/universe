-- 0045 · CB-028 — Págalo: capital opcional para mora sola
-- ============================================================================
-- Requiere la tabla creada por 0039; no reescribe esa migración. Es expand-only
-- y únicamente amplía la
-- restricción de montos para permitir cobros de mora sola. No crea links de
-- CAPITAL en Q0.
-- ============================================================================

ALTER TABLE public.pagalo_payment_groups
  DROP CONSTRAINT IF EXISTS pagalo_payment_groups_amounts_chk,
  ADD CONSTRAINT pagalo_payment_groups_amounts_chk CHECK (
    capital_total >= 0 AND facturable_total > 0 AND total_amount > 0
  );

COMMENT ON COLUMN public.pagalo_payment_groups.capital_total IS
  'Zero only represents mora sola, not a Q0 capital link.';
