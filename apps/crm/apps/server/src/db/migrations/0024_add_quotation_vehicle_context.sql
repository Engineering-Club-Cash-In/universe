ALTER TABLE "quotations"
ADD COLUMN IF NOT EXISTS "vehicle_condition" text NOT NULL DEFAULT 'used';

ALTER TABLE "quotations"
ADD COLUMN IF NOT EXISTS "vehicle_origin" text NOT NULL DEFAULT 'agencia';
