-- COBROS-02 · Workspace de cobros, backend (issue #1873, W4 · abono inicial en el
-- convenio), docs/features/cobros-02/22-plan-backend-workspace.md.
--
-- El abono inicial se registra como un pago normal y contabilidad lo valida. Solo
-- entonces se crea el convenio, que financia lo que queda. Esta columna guarda
-- qué pago sostuvo el convenio, para auditarlo. Única: un abono no sirve para dos
-- convenios.
--
-- Se aplica a mano. Idempotente: se puede correr más de una vez.

ALTER TABLE cartera.convenios_pago
  ADD COLUMN IF NOT EXISTS abono_inicial_pago_id integer REFERENCES cartera.pagos_credito(pago_id);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_convenios_pago_abono_inicial
  ON cartera.convenios_pago (abono_inicial_pago_id)
  WHERE abono_inicial_pago_id IS NOT NULL;
