-- 0009 · CB-105 — pagalo_payment_imports acepta grupos de UN solo link
-- ============================================================================
--
-- Ajuste sobre la 0008, decidido por Daniel 2026-08-24 al sumar el bot de
-- WhatsApp como segundo origen de links (D-48 del bot de cobros):
--
-- Una selección sin capital (crédito solo-interés, insoluto) o solo capital
-- genera UN único link Págalo, no dos. La 0008 exigía ambos montos > 0 y toda
-- la evidencia NOT NULL en ambos lados — un grupo de un solo link no cabía.
--
-- Cambios:
--   1. Evidencia por lado pasa a nullable (uuid, external_identifier, paid_at).
--   2. amounts_chk: montos >= 0 con total > 0 (total_matches garantiza que al
--      menos un lado existe).
--   3. CHECK de coherencia POR LADO, explícito porque PostgreSQL acepta
--      resultado NULL en un CHECK (la misma lección del estado ACCEPT y de las
--      horas de expiración): monto > 0 ⇒ evidencia completa; monto = 0 ⇒ lado
--      totalmente vacío.
--
-- Los CHECK *_different_chk no cambian: con un lado NULL "pasan" (NULL <> x da
-- NULL), que es justo lo que el grupo de un solo link necesita; con ambos
-- presentes siguen impidiendo reutilizar una transacción en los dos roles.
--
-- Expand-only e idempotente. Se aplica a mano DESPUÉS de la 0008. Para el
-- sandbox con schema distinto (cartera_cobros2, donde la 0008 ya corrió),
-- reemplazar `cartera` conscientemente.
-- ============================================================================

ALTER TABLE cartera.pagalo_payment_imports
  ALTER COLUMN capital_transaction_uuid DROP NOT NULL,
  ALTER COLUMN facturable_transaction_uuid DROP NOT NULL,
  ALTER COLUMN capital_external_identifier DROP NOT NULL,
  ALTER COLUMN facturable_external_identifier DROP NOT NULL,
  ALTER COLUMN capital_paid_at DROP NOT NULL,
  ALTER COLUMN facturable_paid_at DROP NOT NULL;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_amounts_chk;
ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_amounts_chk CHECK (
    capital_total >= 0 AND facturable_total >= 0 AND total_amount > 0
  );

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_capital_evidence_chk;
ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_capital_evidence_chk CHECK (
    (
      capital_total > 0
      AND capital_transaction_uuid IS NOT NULL
      AND capital_external_identifier IS NOT NULL
      AND capital_paid_at IS NOT NULL
    ) OR (
      capital_total = 0
      AND capital_transaction_uuid IS NULL
      AND capital_external_identifier IS NULL
      AND capital_paid_at IS NULL
      AND capital_request_id IS NULL
      AND capital_request_auth IS NULL
    )
  );

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_facturable_evidence_chk;
ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_facturable_evidence_chk CHECK (
    (
      facturable_total > 0
      AND facturable_transaction_uuid IS NOT NULL
      AND facturable_external_identifier IS NOT NULL
      AND facturable_paid_at IS NOT NULL
    ) OR (
      facturable_total = 0
      AND facturable_transaction_uuid IS NULL
      AND facturable_external_identifier IS NULL
      AND facturable_paid_at IS NULL
      AND facturable_request_id IS NULL
      AND facturable_request_auth IS NULL
    )
  );

COMMENT ON COLUMN cartera.pagalo_payment_imports.capital_transaction_uuid IS
  'Transacción ACCEPT del link CAPITAL; NULL cuando el grupo no tiene lado capital (capital_total = 0).';
COMMENT ON COLUMN cartera.pagalo_payment_imports.facturable_transaction_uuid IS
  'Transacción ACCEPT del link MORA_INTERES; NULL cuando el grupo no tiene lado facturable (facturable_total = 0).';
