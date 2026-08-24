-- 0045 · CB-105 — El grupo Págalo acepta UN solo link y conoce su origen
-- ============================================================================
--
-- Ajustes sobre la 0039 (ya aplicada en dev), decididos por Daniel 2026-08-24
-- al sumar el bot de WhatsApp como segundo origen de links (D-45, D-48):
--
-- 1. UN SOLO LINK CUANDO UN LADO ES Q0. Una selección sin capital (crédito
--    solo-interés, insoluto) o solo capital genera un único link. El CHECK
--    exigía ambos montos > 0; ahora exige >= 0 con total > 0 — junto con
--    total_matches (total = capital + facturable) garantiza que al menos un
--    lado existe. El servicio NO debe crear el link del lado que vale 0.
--
-- 2. ORIGEN DEL GRUPO: 'ASESOR' (pantalla de cobros) o 'BOT' (WhatsApp).
--    DEFAULT 'ASESOR' porque todo lo existente nació de ahí.
--
-- 3. ASESOR ASIGNADO DEL CRÉDITO al momento de crear el grupo
--    (cartera.creditos.asesor_id). ID opaco de cartera-back, sin FK entre
--    bases (mismo criterio que cartera_credito_id). Nullable: hay créditos
--    sin asesor asignado.

ALTER TABLE "pagalo_payment_groups"
	ADD COLUMN IF NOT EXISTS "origen" text NOT NULL DEFAULT 'ASESOR';

ALTER TABLE "pagalo_payment_groups"
	ADD COLUMN IF NOT EXISTS "cartera_asesor_id" integer;

ALTER TABLE "pagalo_payment_groups"
	DROP CONSTRAINT IF EXISTS "pagalo_payment_groups_origen_chk";
ALTER TABLE "pagalo_payment_groups"
	ADD CONSTRAINT "pagalo_payment_groups_origen_chk"
	CHECK ("origen" IN ('ASESOR', 'BOT'));

ALTER TABLE "pagalo_payment_groups"
	DROP CONSTRAINT IF EXISTS "pagalo_payment_groups_amounts_chk";
ALTER TABLE "pagalo_payment_groups"
	ADD CONSTRAINT "pagalo_payment_groups_amounts_chk"
	CHECK (
		"capital_total" >= 0
		AND "facturable_total" >= 0
		AND "total_amount" > 0
	);

COMMENT ON COLUMN "pagalo_payment_groups"."origen" IS
	'Quién generó el grupo: ASESOR (pantalla de cobros) o BOT (WhatsApp). D-45.';
COMMENT ON COLUMN "pagalo_payment_groups"."cartera_asesor_id" IS
	'Asesor asignado del crédito al crear el grupo (cartera.creditos.asesor_id); ID opaco, sin FK entre bases.';
