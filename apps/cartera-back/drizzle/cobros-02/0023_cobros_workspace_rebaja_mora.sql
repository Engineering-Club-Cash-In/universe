-- COBROS-02 · Workspace de cobros, backend (issue #1873,
-- docs/features/cobros-02/22-plan-backend-workspace.md).
--
-- W2 · Rebaja de mora parcial aprobada por el supervisor en el CRM. La
-- condonación parcial reutiliza `moras_condonaciones`. Esta columna la deja
-- idempotente: el CRM manda como `referencia_externa` el id de su solicitud, y
-- un reintento de la misma aprobación no descuenta la mora dos veces.
--
-- Se aplica a mano. Idempotente: se puede correr más de una vez.

ALTER TABLE cartera.moras_condonaciones
	ADD COLUMN IF NOT EXISTS referencia_externa text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_moras_condonaciones_referencia_externa
	ON cartera.moras_condonaciones (referencia_externa)
	WHERE referencia_externa IS NOT NULL;
