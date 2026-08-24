-- 0009 · Págalo mora-only: CAPITAL opcional
-- ============================================================================
-- Requiere el ledger creado por 0008; no reescribe esa migración. Esta migración
-- no altera datos ni pagos existentes;
-- únicamente ajusta el ledger en el schema cartera para aceptar una o dos
-- transacciones Págalo: MORA_INTERES siempre y CAPITAL solo cuando corresponda.
-- Es segura para reejecutar: solo relaja columnas CAPITAL que aún son NOT NULL.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'cartera'
      AND table_name = 'pagalo_payment_imports'
      AND column_name = 'capital_transaction_uuid'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE cartera.pagalo_payment_imports
      ALTER COLUMN capital_transaction_uuid DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'cartera'
      AND table_name = 'pagalo_payment_imports'
      AND column_name = 'capital_external_identifier'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE cartera.pagalo_payment_imports
      ALTER COLUMN capital_external_identifier DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'cartera'
      AND table_name = 'pagalo_payment_imports'
      AND column_name = 'capital_paid_at'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE cartera.pagalo_payment_imports
      ALTER COLUMN capital_paid_at DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_amounts_chk,
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_capital_evidence_chk,
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_transactions_different_chk,
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_external_ids_different_chk,
  ADD CONSTRAINT pagalo_payment_imports_amounts_chk CHECK (
    capital_total >= 0 AND facturable_total > 0 AND total_amount > 0
  ),
  ADD CONSTRAINT pagalo_payment_imports_capital_evidence_chk CHECK (
    (
      capital_total = 0
      AND capital_transaction_uuid IS NULL
      AND capital_external_identifier IS NULL
      AND capital_request_id IS NULL
      AND capital_request_auth IS NULL
      AND capital_paid_at IS NULL
    )
    OR (
      capital_total > 0
      AND capital_transaction_uuid IS NOT NULL
      AND capital_external_identifier IS NOT NULL
      AND capital_paid_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT pagalo_payment_imports_transactions_different_chk CHECK (
    capital_transaction_uuid IS NULL
    OR capital_transaction_uuid <> facturable_transaction_uuid
  ),
  ADD CONSTRAINT pagalo_payment_imports_external_ids_different_chk CHECK (
    capital_external_identifier IS NULL
    OR capital_external_identifier <> facturable_external_identifier
  );

COMMENT ON TABLE cartera.pagalo_payment_imports IS
  'Ledger idempotente por grupo CRM. Contiene una o dos transacciones Págalo ACCEPT y relaciona N pagos_credito.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.capital_transaction_uuid IS
  'UUID de transacción CAPITAL ACCEPT; nullable solo para importación mora-only.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.capital_external_identifier IS
  'Identificador externo CAPITAL ACCEPT; nullable solo para importación mora-only.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.capital_paid_at IS
  'Fecha de pago CAPITAL ACCEPT; nullable solo para importación mora-only.';

COMMIT;
