-- Motivo independiente para cambios de monto_aportado en el espejo.
-- NO ejecutar automáticamente: aplicar manualmente en DEV/PROD después de
-- desplegar código. Es idempotente y no modifica datos existentes.

ALTER TABLE cartera.historico_monto_aportado_espejo
  ADD COLUMN IF NOT EXISTS motivo TEXT;

CREATE OR REPLACE FUNCTION cartera.audit_monto_aportado_espejo_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id  INT;
  v_email    VARCHAR(200);
  v_source   TEXT;
  v_setting  TEXT;
  v_motivo   TEXT;
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

  v_motivo := NULLIF(current_setting('app.monto_aportado_motivo', true), '');

  INSERT INTO cartera.historico_monto_aportado_espejo
    (txid, operacion, credito_id, inversionista_id,
     monto_anterior, monto_nuevo,
     platform_user_id, user_email, source, motivo)
  VALUES (
    txid_current(),
    TG_OP,
    COALESCE(NEW.credito_id,       OLD.credito_id),
    COALESCE(NEW.inversionista_id, OLD.inversionista_id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.monto_aportado END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.monto_aportado END,
    v_user_id,
    v_email,
    v_source,
    v_motivo
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
