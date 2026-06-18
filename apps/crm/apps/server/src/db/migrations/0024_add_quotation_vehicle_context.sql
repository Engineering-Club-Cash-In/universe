ALTER TABLE "quotations"
ADD COLUMN IF NOT EXISTS "vehicle_condition" text NOT NULL DEFAULT 'used';

ALTER TABLE "quotations"
ADD COLUMN IF NOT EXISTS "vehicle_origin" text NOT NULL DEFAULT 'agencia';

UPDATE "quotations"
SET "vehicle_condition" = 'new'
WHERE "vehicle_type" = 'nuevo';
