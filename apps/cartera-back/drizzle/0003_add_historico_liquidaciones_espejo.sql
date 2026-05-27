CREATE TABLE IF NOT EXISTS cartera.historico_liquidaciones_espejo (
    id SERIAL PRIMARY KEY,
    monto_aportado NUMERIC(18, 8) NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    inversionista_id INTEGER NOT NULL
        REFERENCES cartera.inversionistas(inversionista_id) ON DELETE CASCADE,
    credito_id INTEGER NOT NULL
        REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
    liquidacion_id INTEGER
        REFERENCES cartera.liquidaciones(liquidacion_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_historico_liq_inv_cred
    ON cartera.historico_liquidaciones_espejo (inversionista_id, credito_id);

CREATE INDEX IF NOT EXISTS ix_historico_liq_fecha
    ON cartera.historico_liquidaciones_espejo (fecha);

CREATE INDEX IF NOT EXISTS ix_historico_liq_liquidacion_id
    ON cartera.historico_liquidaciones_espejo (liquidacion_id);
