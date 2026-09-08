CREATE TABLE IF NOT EXISTS cartera.nexa_credit_bindings (
  credito_id INTEGER PRIMARY KEY REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  max_payment_amount NUMERIC(18, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cartera.nexa_payment_nonces (
  nonce VARCHAR(150) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cartera.nexa_payment_events (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(20) NOT NULL DEFAULT 'NEXA',
  external_reference VARCHAR(150) NOT NULL,
  nonce VARCHAR(150) NOT NULL,
  credito_id INTEGER NOT NULL REFERENCES cartera.creditos(credito_id),
  amount NUMERIC(18, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  pago_id INTEGER REFERENCES cartera.pagos_credito(pago_id),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_nexa_payment_events_provider_reference UNIQUE (provider, external_reference)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nexa_payment_events_nonce
  ON cartera.nexa_payment_events (nonce);
