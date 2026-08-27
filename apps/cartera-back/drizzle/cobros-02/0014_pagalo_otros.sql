BEGIN;

ALTER TABLE cartera.pagalo_payment_imports
  ADD COLUMN IF NOT EXISTS otros_total numeric(18,2) NOT NULL DEFAULT '0.00';

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_otros_total_chk;
ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_otros_total_chk
  CHECK (otros_total >= 0);

COMMIT;
