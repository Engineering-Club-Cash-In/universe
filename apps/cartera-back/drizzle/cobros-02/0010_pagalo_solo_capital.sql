-- 0010 · CB-105 — El ledger también acepta importaciones de solo capital
-- ============================================================================
--
-- Las 0009 gemelas (0009_pagalo_un_solo_link de CB-105 y
-- 0009_pagalo_optional_capital de CB-028/#1422) relajaron el mismo ledger en
-- paralelo con alcances distintos: la de CB-105 permite Q0 en cualquiera de
-- los dos lados (decisión de Daniel en D-48: mora-only Y solo-capital); la de
-- CB-028 solo mora-only (facturable_total > 0, columnas facturable_* NOT
-- NULL). Como ambas hacen DROP+ADD de pagalo_payment_imports_amounts_chk, el
-- estado final dependía del orden — y en el sandbox la de CB-028 corrió
-- después y pisó la simétrica.
--
-- Esta migración re-afirma el estado final decidido. Idempotente y segura
-- corra lo que corra antes: la ÚLTIMA palabra sobre el check de montos y la
-- nulabilidad del lado facturable. Los *_evidence_chk de ambos lados ya
-- existen (0009 de CB-105) y no se tocan.
--
-- Para el sandbox con schema distinto (cartera_cobros2), reemplazar `cartera`
-- conscientemente.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cartera'
      AND table_name = 'pagalo_payment_imports'
      AND column_name = 'facturable_transaction_uuid'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE cartera.pagalo_payment_imports
      ALTER COLUMN facturable_transaction_uuid DROP NOT NULL,
      ALTER COLUMN facturable_external_identifier DROP NOT NULL,
      ALTER COLUMN facturable_paid_at DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_amounts_chk;
ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_amounts_chk CHECK (
    capital_total >= 0 AND facturable_total >= 0 AND total_amount > 0
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

COMMENT ON COLUMN cartera.pagalo_payment_imports.facturable_transaction_uuid IS
  'Transacción ACCEPT del link MORA_INTERES; NULL cuando el grupo no tiene lado facturable (facturable_total = 0).';
