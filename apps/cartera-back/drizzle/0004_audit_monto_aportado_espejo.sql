-- Auditoría de cambios en monto_aportado de creditos_inversionistas_espejo.
-- El trigger captura DELETE e INSERT (el código hace DELETE+INSERT en cada actualización)
-- y los correlaciona via txid para poder ver "anterior → nuevo" en una sola query.

CREATE TABLE cartera.historico_monto_aportado_espejo (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txid              BIGINT        NOT NULL,
  operacion         TEXT          NOT NULL,
  credito_id        INT           NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  inversionista_id  INT           NOT NULL REFERENCES cartera.inversionistas(inversionista_id) ON DELETE CASCADE,
  monto_aportado    NUMERIC(18,8) NOT NULL,
  platform_user_id  INT           REFERENCES cartera.platform_users(id) ON DELETE SET NULL,
  source            TEXT          NOT NULL DEFAULT 'unknown',
  fecha             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_hist_mont_txid  ON cartera.historico_monto_aportado_espejo (txid);
CREATE INDEX ix_hist_mont_cred  ON cartera.historico_monto_aportado_espejo (credito_id, inversionista_id);
CREATE INDEX ix_hist_mont_fecha ON cartera.historico_monto_aportado_espejo (fecha);

-- ──────────────────────────────────────────────────────────────
-- Función trigger
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cartera.audit_monto_aportado_espejo_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id INT;
  v_source  TEXT;
  v_setting TEXT;
  v_row     cartera.creditos_inversionistas_espejo%ROWTYPE;
BEGIN
  v_setting := current_setting('app.current_user_id', true);
  IF v_setting IS NOT NULL AND v_setting <> '' THEN
    v_user_id := v_setting::INT;
    v_source  := 'api_session';
  ELSE
    v_user_id := NULL;
    v_source  := 'manual';
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  INSERT INTO cartera.historico_monto_aportado_espejo
    (txid, operacion, credito_id, inversionista_id, monto_aportado, platform_user_id, source)
  VALUES
    (txid_current(), TG_OP, v_row.credito_id, v_row.inversionista_id,
     v_row.monto_aportado, v_user_id, v_source);

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

-- ──────────────────────────────────────────────────────────────
-- Trigger en creditos_inversionistas_espejo
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_monto_aportado_espejo
  ON cartera.creditos_inversionistas_espejo;

CREATE TRIGGER trg_audit_monto_aportado_espejo
AFTER INSERT OR DELETE
ON cartera.creditos_inversionistas_espejo
FOR EACH ROW
EXECUTE FUNCTION cartera.audit_monto_aportado_espejo_fn();

-- ──────────────────────────────────────────────────────────────
-- Query de referencia: ver cambios "anterior → nuevo"
-- SELECT d.monto_aportado AS anterior,
--        i.monto_aportado AS nuevo,
--        d.credito_id, d.inversionista_id, d.platform_user_id, d.source, d.fecha
-- FROM cartera.historico_monto_aportado_espejo d
-- JOIN cartera.historico_monto_aportado_espejo i
--   ON d.txid = i.txid
--  AND d.credito_id = i.credito_id
--  AND d.inversionista_id = i.inversionista_id
--  AND d.operacion = 'DELETE'
--  AND i.operacion = 'INSERT'
-- ORDER BY d.fecha DESC;
-- ──────────────────────────────────────────────────────────────
