BEGIN;

-- Un ACCEPT Págalo debe poder quedar auditado aun si, antes del dispatcher,
-- SIFCO fue corregido o el crédito se eliminó. APPLIED conserva la identidad
-- viva; solo REVIEW_REQUIRED permite ambos campos NULL.
ALTER TABLE cartera.pagalo_payment_imports
  ALTER COLUMN credito_id DROP NOT NULL,
  ALTER COLUMN numero_credito_sifco DROP NOT NULL;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_credit_sifco_fk;

ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_credit_sifco_fk
  FOREIGN KEY (credito_id, numero_credito_sifco)
  REFERENCES cartera.creditos(credito_id, numero_credito_sifco)
  ON DELETE SET NULL;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_live_credit_chk;

ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_live_credit_chk CHECK (
    status = 'REVIEW_REQUIRED'
    OR (credito_id IS NOT NULL AND numero_credito_sifco IS NOT NULL)
  );

COMMIT;
