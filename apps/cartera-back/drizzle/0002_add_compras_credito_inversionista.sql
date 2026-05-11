CREATE TABLE IF NOT EXISTS cartera.compras_credito_inversionista (
    id SERIAL PRIMARY KEY,
    credito_id INTEGER NOT NULL REFERENCES cartera.creditos(credito_id),
    inversionista_id INTEGER NOT NULL REFERENCES cartera.inversionistas(inversionista_id),
    monto_aportado NUMERIC(18, 8) NOT NULL,
    tipo_operacion VARCHAR(30) NOT NULL,
    tipo_reinversion cartera.tipo_reinversion,
    status cartera.status_credito_inversionista_espejo NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_compras_credito_inv_status
    ON cartera.compras_credito_inversionista (status);

CREATE INDEX IF NOT EXISTS ix_compras_credito_inv_credito_inv
    ON cartera.compras_credito_inversionista (credito_id, inversionista_id);
