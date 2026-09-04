-- Auditoría compartida para monto_aportado fiscal (PADRE) y espejo (ESPEJO).
-- Consolida motivo + origen en una única migración manual e idempotente.
-- Conserva filas existentes como ESPEJO.

ALTER TABLE cartera.historico_monto_aportado_espejo
  ADD COLUMN IF NOT EXISTS motivo TEXT;

ALTER TABLE cartera.historico_monto_aportado_espejo
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'ESPEJO';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_historico_monto_aportado_origen'
      AND conrelid = 'cartera.historico_monto_aportado_espejo'::regclass
  ) THEN
    ALTER TABLE cartera.historico_monto_aportado_espejo
      ADD CONSTRAINT chk_historico_monto_aportado_origen
      CHECK (origen IN ('PADRE', 'ESPEJO'));
  END IF;
END;
$$;

-- CONCURRENTLY para no bloquear las escrituras del trigger mientras se
-- construye: esta tabla recibe una fila por cada movimiento de inversionistas,
-- y un CREATE INDEX normal congelaría pagos, liquidaciones y rebuild de espejo.
-- Debe ejecutarse FUERA de transacción (no dentro de un bloque DO ni de un
-- BEGIN/COMMIT); si falla deja el índice INVALID y se reintenta tras un DROP.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_hist_mont_origen_cred_fecha
  ON cartera.historico_monto_aportado_espejo
  (origen, credito_id, inversionista_id, fecha);

CREATE OR REPLACE FUNCTION cartera.audit_monto_aportado_espejo_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id  INT;
  v_email    VARCHAR(200);
  v_source   TEXT;
  v_setting  TEXT;
  v_motivo   TEXT;
  v_origen   TEXT;
  v_rebuild  BOOLEAN;
  v_ids      TEXT;
  v_es_monto_cambiado BOOLEAN;
BEGIN
  v_origen := CASE
    WHEN TG_TABLE_NAME = 'creditos_inversionistas' THEN 'PADRE'
    ELSE 'ESPEJO'
  END;

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

  v_motivo := NULLIF(
    current_setting(
      CASE v_origen
        WHEN 'PADRE' THEN 'app.monto_aportado_motivo_padre'
        ELSE 'app.monto_aportado_motivo_espejo'
      END,
      true
    ),
    ''
  );

  v_rebuild := COALESCE(
    NULLIF(
      current_setting(
        CASE v_origen
          WHEN 'PADRE' THEN 'app.monto_aportado_rebuild_padre'
          ELSE 'app.monto_aportado_rebuild_espejo'
        END,
        true
      ),
      ''
    ),
    'false'
  )::BOOLEAN;
  v_ids := COALESCE(
    current_setting(
      CASE v_origen
        WHEN 'PADRE' THEN 'app.monto_aportado_ids_padre'
        ELSE 'app.monto_aportado_ids_espejo'
      END,
      true
    ),
    ''
  );
  v_es_monto_cambiado := position(
    ',' || COALESCE(NEW.inversionista_id, OLD.inversionista_id)::TEXT || ','
    IN ',' || v_ids || ','
  ) > 0;

  -- Sin contexto, conservar auditoría histórica de INSERT/DELETE. Durante el
  -- rebuild final de updateCredit, solo los IDs marcados generan historial.
  IF TG_OP IN ('INSERT', 'DELETE')
    AND v_rebuild AND NOT v_es_monto_cambiado THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Los UPDATE se auditan siempre, incluso sin cambio de monto: el trigger
  -- original (0004) no acotaba por columna y verificarCuadreLiquidaciones
  -- descubre los créditos movidos tras una liquidación por la sola presencia
  -- de filas ESPEJO posteriores (creditos_rel). Filtrarlos sacaría del set a
  -- los créditos que solo registraron un UPDATE de otra columna
  -- (mirrorInvestor, investor con monto igual) y su pendiente dejaría de
  -- contarse, produciendo descuadres falsos.

  INSERT INTO cartera.historico_monto_aportado_espejo
    (txid, operacion, origen, credito_id, inversionista_id,
     monto_anterior, monto_nuevo,
     platform_user_id, user_email, source, motivo)
  VALUES (
    txid_current(),
    TG_OP,
    v_origen,
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

DROP TRIGGER IF EXISTS trg_audit_monto_aportado_padre
  ON cartera.creditos_inversionistas;

CREATE TRIGGER trg_audit_monto_aportado_padre
AFTER INSERT OR UPDATE OF monto_aportado OR DELETE
ON cartera.creditos_inversionistas
FOR EACH ROW
EXECUTE FUNCTION cartera.audit_monto_aportado_espejo_fn();
