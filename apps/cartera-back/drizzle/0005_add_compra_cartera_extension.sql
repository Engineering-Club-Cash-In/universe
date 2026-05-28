ALTER TABLE "Cartera"."creditos_inversionistas_espejo"
ADD COLUMN IF NOT EXISTS "compra_cartera_extendida_at" timestamp with time zone;
