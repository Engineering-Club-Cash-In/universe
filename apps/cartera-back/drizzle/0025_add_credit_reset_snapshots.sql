-- Snapshot de reversa para resetCredit: `payload` guarda lo que la cancelación
-- destruye (creditos, creditos_inversionistas, pagos anulados, mora) capturado
-- antes de mutar; `artefactos_creados` guarda los IDs de lo que el cierre creó,
-- para que la reversa borre por ID sin heurísticas. `estado`: VIVO (reversable),
-- RESTAURADO (reversa ejecutada; restaurado_at/por auditan quién y cuándo) o
-- SUPERSEDED (reemplazado por un nuevo cierre del mismo crédito). Un solo
-- snapshot VIVO por crédito. Idempotente; aplicar manualmente.

CREATE TABLE IF NOT EXISTS cartera.credit_reset_snapshots (
  id                  SERIAL PRIMARY KEY,
  credito_id          INT          NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  pago_cierre_id      INT          REFERENCES cartera.pagos_credito(pago_id) ON DELETE SET NULL,
  version             INT          NOT NULL DEFAULT 1,
  payload             JSONB        NOT NULL,
  artefactos_creados  JSONB,
  estado              TEXT         NOT NULL DEFAULT 'VIVO'
                      CONSTRAINT credit_reset_snapshots_estado_check
                      CHECK (estado IN ('VIVO','RESTAURADO','SUPERSEDED')),
  restaurado_at       TIMESTAMPTZ,
  restaurado_por      TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_credit_reset_snapshots_credito
  ON cartera.credit_reset_snapshots (credito_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_reset_snapshots_credito_vivo
  ON cartera.credit_reset_snapshots (credito_id)
  WHERE estado = 'VIVO';

