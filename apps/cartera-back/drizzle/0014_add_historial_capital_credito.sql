-- Historial de cambios del capital de un crédito.
-- Un trigger sobre cartera.creditos captura TODO cambio de `capital` (venga de
-- ajuste manual, pago, reverso, castigo, merge, import...). La app decora cada
-- cambio con fuente/usuario/motivo vía GUCs de sesión (SET LOCAL), igual que el
-- patrón de historico_monto_aportado_espejo (0004).
--
--   SET LOCAL app.current_user_id = '<id>'
--   SET LOCAL app.capital_source  = 'AJUSTE_MANUAL' | 'PAGO' | 'REVERSO' | 'CASTIGO' | 'MERGE'
--   SET LOCAL app.capital_motivo  = '<texto libre>'
--
-- Si no viene fuente: INSERT => 'CREACION', UPDATE => 'SISTEMA'. Nunca se pierde
-- un cambio aunque el write site no esté instrumentado.
--
-- ⚠️ APLICAR MANUALMENTE (mismo patrón que 0004 y demás triggers del repo):
-- `drizzle-kit push` (script `migrate`) sincroniza SOLO el schema de schema.ts
-- (crea la TABLA) pero NO ejecuta este .sql, así que la FUNCIÓN y el TRIGGER hay
-- que aplicarlos a mano en cada base. Todo el archivo es idempotente
-- (CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS), así que
-- se puede re-correr sin riesgo. Ya aplicado en PROD y DEV.

-- 1. Tabla de historial
CREATE TABLE IF NOT EXISTS cartera.historial_capital_credito (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txid              BIGINT        NOT NULL,
  operacion         TEXT          NOT NULL,                 -- INSERT | UPDATE
  credito_id        INT           NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  capital_anterior  NUMERIC(18,2),
  capital_nuevo     NUMERIC(18,2),
  fuente            TEXT          NOT NULL DEFAULT 'SISTEMA',
  motivo            TEXT,
  platform_user_id  INT           REFERENCES cartera.platform_users(id) ON DELETE SET NULL,
  user_email        VARCHAR(200),
  fecha             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_hist_cap_cred   ON cartera.historial_capital_credito (credito_id, fecha DESC);
CREATE INDEX IF NOT EXISTS ix_hist_cap_fecha  ON cartera.historial_capital_credito (fecha);
CREATE INDEX IF NOT EXISTS ix_hist_cap_fuente ON cartera.historial_capital_credito (fuente);

-- 2. Función trigger
CREATE OR REPLACE FUNCTION cartera.historial_capital_credito_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_user_setting TEXT;
  v_user_id      INT;
  v_email        VARCHAR(200);
  v_source       TEXT;
  v_motivo       TEXT;
BEGIN
  -- En UPDATE, solo registrar si el capital realmente cambió.
  IF TG_OP = 'UPDATE' AND NEW.capital IS NOT DISTINCT FROM OLD.capital THEN
    RETURN NEW;
  END IF;

  -- Fuente: GUC de la app, o default según operación.
  v_source := NULLIF(current_setting('app.capital_source', true), '');
  IF v_source IS NULL THEN
    v_source := CASE WHEN TG_OP = 'INSERT' THEN 'CREACION' ELSE 'SISTEMA' END;
  END IF;

  -- Motivo (texto libre del modal), opcional.
  v_motivo := NULLIF(current_setting('app.capital_motivo', true), '');

  -- Usuario: resolver contra platform_users; si no existe, dejar NULL
  -- (evita que un id inválido en el GUC rompa el UPDATE del crédito por FK).
  v_user_setting := NULLIF(current_setting('app.current_user_id', true), '');
  IF v_user_setting IS NOT NULL THEN
    SELECT id, email INTO v_user_id, v_email
      FROM cartera.platform_users
     WHERE id = v_user_setting::INT;
  END IF;

  INSERT INTO cartera.historial_capital_credito
    (txid, operacion, credito_id, capital_anterior, capital_nuevo,
     fuente, motivo, platform_user_id, user_email)
  VALUES (
    txid_current(),
    TG_OP,
    COALESCE(NEW.credito_id, OLD.credito_id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.capital END,
    NEW.capital,
    v_source,
    v_motivo,
    v_user_id,
    v_email
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger. `UPDATE OF capital` => solo dispara cuando el UPDATE toca la
-- columna capital (los edits de teléfono/dirección no pagan overhead).
DROP TRIGGER IF EXISTS trg_historial_capital_credito ON cartera.creditos;

CREATE TRIGGER trg_historial_capital_credito
AFTER INSERT OR UPDATE OF capital ON cartera.creditos
FOR EACH ROW
EXECUTE FUNCTION cartera.historial_capital_credito_fn();
