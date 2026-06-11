-- Auditoría de cambios en monto_aportado de creditos_inversionistas_espejo.
-- Captura INSERT, UPDATE y DELETE.
-- UPDATE directo en BD → monto_anterior y monto_nuevo en la misma fila.
-- DELETE+INSERT via API → correlacionados por txid en la vista.

-- 1. Tabla de auditoría
CREATE TABLE cartera.historico_monto_aportado_espejo (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txid              BIGINT        NOT NULL,
  operacion         TEXT          NOT NULL,
  credito_id        INT           NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  inversionista_id  INT           NOT NULL REFERENCES cartera.inversionistas(inversionista_id) ON DELETE CASCADE,
  monto_anterior    NUMERIC(18,8),
  monto_nuevo       NUMERIC(18,8),
  platform_user_id  INT           REFERENCES cartera.platform_users(id) ON DELETE SET NULL,
  user_email        VARCHAR(200),
  source            TEXT          NOT NULL DEFAULT 'unknown',
  fecha             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_hist_mont_txid  ON cartera.historico_monto_aportado_espejo (txid);
CREATE INDEX ix_hist_mont_cred  ON cartera.historico_monto_aportado_espejo (credito_id, inversionista_id);
CREATE INDEX ix_hist_mont_fecha ON cartera.historico_monto_aportado_espejo (fecha);

-- 2. Función trigger
CREATE OR REPLACE FUNCTION cartera.audit_monto_aportado_espejo_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id  INT;
  v_email    VARCHAR(200);
  v_source   TEXT;
  v_setting  TEXT;
BEGIN
  v_setting := current_setting('app.current_user_id', true);
  IF v_setting IS NOT NULL AND v_setting <> '' THEN
    v_user_id := v_setting::INT;
    v_source  := 'api_session';
    SELECT email INTO v_email
      FROM cartera.platform_users
     WHERE id = v_user_id;
  ELSE
    v_user_id := NULL;
    v_email   := NULL;
    v_source  := 'manual';
  END IF;

  INSERT INTO cartera.historico_monto_aportado_espejo
    (txid, operacion, credito_id, inversionista_id,
     monto_anterior, monto_nuevo,
     platform_user_id, user_email, source)
  VALUES (
    txid_current(),
    TG_OP,
    COALESCE(NEW.credito_id,       OLD.credito_id),
    COALESCE(NEW.inversionista_id, OLD.inversionista_id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.monto_aportado END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.monto_aportado END,
    v_user_id,
    v_email,
    v_source
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger (INSERT + UPDATE + DELETE)
DROP TRIGGER IF EXISTS trg_audit_monto_aportado_espejo
  ON cartera.creditos_inversionistas_espejo;

CREATE TRIGGER trg_audit_monto_aportado_espejo
AFTER INSERT OR UPDATE OR DELETE
ON cartera.creditos_inversionistas_espejo
FOR EACH ROW
EXECUTE FUNCTION cartera.audit_monto_aportado_espejo_fn();

