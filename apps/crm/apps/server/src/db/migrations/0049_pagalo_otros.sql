ALTER TABLE "pagalo_payment_groups"
  ADD COLUMN IF NOT EXISTS "otros_total" numeric(18,2) NOT NULL DEFAULT '0.00';

ALTER TABLE "pagalo_payment_groups"
  DROP CONSTRAINT IF EXISTS "pagalo_payment_groups_otros_total_chk";
ALTER TABLE "pagalo_payment_groups"
  ADD CONSTRAINT "pagalo_payment_groups_otros_total_chk"
  CHECK ("otros_total" >= 0);
