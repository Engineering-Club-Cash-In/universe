-- 0048 · CB-105 — El lado facturable también puede ser Q0 (estado final D-48)
-- ============================================================================
--
-- CB-105 (0045_pagalo_grupo_un_link_origen) y CB-028 (#1422,
-- 0045_cb028_pagalo_optional_capital) relajaron el MISMO check en paralelo con
-- alcances distintos: la nuestra permite Q0 en cualquiera de los dos lados
-- (decisión de Daniel en D-48: mora-only Y solo-capital); la de Jose solo
-- mora-only (facturable_total > 0). Como ambas hacen DROP+ADD del mismo
-- constraint, el estado final dependía del ORDEN en que corrieran — y en dev
-- la de Jose corrió después y pisó la simétrica.
--
-- Esta migración re-afirma el estado final decidido, es idempotente, y es
-- segura corra lo que corra antes: dejarla como la ÚLTIMA palabra sobre
-- pagalo_payment_groups_amounts_chk.
--
-- El caso solo-capital es real: una cuota cuyo pago parcial ya cubrió interés
-- y demás rubros queda con saldo de puro capital — y por los saldos (§4.1 del
-- contrato) esa selección arma un grupo con facturable_total = 0.

ALTER TABLE "pagalo_payment_groups"
	DROP CONSTRAINT IF EXISTS "pagalo_payment_groups_amounts_chk";
ALTER TABLE "pagalo_payment_groups"
	ADD CONSTRAINT "pagalo_payment_groups_amounts_chk"
	CHECK (
		"capital_total" >= 0
		AND "facturable_total" >= 0
		AND "total_amount" > 0
	);

COMMENT ON COLUMN "pagalo_payment_groups"."capital_total" IS
	'Q0 = grupo sin lado capital (mora-only); el link CAPITAL no se crea. D-48.';
COMMENT ON COLUMN "pagalo_payment_groups"."facturable_total" IS
	'Q0 = grupo sin lado facturable (solo capital); el link MORA_INTERES no se crea. D-48.';
