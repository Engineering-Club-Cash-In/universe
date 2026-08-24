-- 0027 · CB-028 — Importación Págalo idempotente (1 tabla nueva)
-- ============================================================================
--
-- CRM envía una orden solo cuando links CAPITAL y MORA_INTERES están ACCEPT,
-- montos coinciden y vouchers existen. Cartera guarda una fila por grupo para
-- impedir doble aplicación y relaciona N pagos_credito mediante pagalo_import_id.
--
-- PROTECCIÓN
-- ----------
-- - crm_group_id UNIQUE: retry/timeout devuelve importación existente.
-- - UUID e external_identifier de cada rol son UNIQUE.
-- - UUIDs/identificadores de ambos links deben ser distintos.
-- - payload_hash detecta mismo grupo reintentado con contenido diferente.
--
-- Como modelo reducido coloca dos UUIDs en columnas, UNIQUE no detecta por sí
-- solo cruce de rol entre filas (capital de A usado como facturable de B). CRM
-- protege transaction_uuid globalmente. Servicio cartera debe además tomar lock
-- y consultar AMBAS columnas antes de insertar. Modelo previo con tabla sources
-- daba defensa puramente relacional, pero se retiró para alcance MVP.
--
-- `newPayment` actual no es transaccional. Servicio futuro debe crear importación
-- y pagos iniciales en una transacción, o reanudar por pagalo_import_id. Nunca
-- reintentar newPayment a ciegas tras timeout.
--
-- Voucher sigue usando cartera.boletas. Facturación sigue usando desglose actual:
-- capital no se factura; mora/interés/IVA sí según flujo existente.
--
-- Expand-only, todavía no aplicada. NO ejecutar automáticamente. Para sandbox
-- con schema distinto, reemplazar `cartera` conscientemente.
-- ============================================================================

ALTER TYPE public.origen_pago ADD VALUE IF NOT EXISTS 'pagalo';

CREATE TABLE IF NOT EXISTS cartera.pagalo_payment_imports (
  id                              serial PRIMARY KEY,
  -- UUID opaco de CRM; no existe FK entre bases.
  crm_group_id                    varchar(36) NOT NULL,
  credito_id                      integer NOT NULL
    REFERENCES cartera.creditos(credito_id) ON DELETE RESTRICT,
  numero_credito_sifco            varchar(40) NOT NULL,
  currency                        varchar(3) NOT NULL DEFAULT 'GTQ',

  capital_total                   numeric(18,2) NOT NULL,
  facturable_total                numeric(18,2) NOT NULL,
  total_amount                    numeric(18,2) NOT NULL,

  -- Evidencia mínima de los dos ACCEPT. request_auth es código comercial de
  -- transacción, nunca credencial del header authorization.
  capital_transaction_uuid        varchar(64) NOT NULL,
  facturable_transaction_uuid     varchar(64) NOT NULL,
  capital_external_identifier     varchar(150) NOT NULL,
  facturable_external_identifier  varchar(150) NOT NULL,
  capital_request_id              varchar(100),
  facturable_request_id           varchar(100),
  capital_request_auth            varchar(100),
  facturable_request_auth         varchar(100),
  capital_paid_at                 timestamp with time zone NOT NULL,
  facturable_paid_at              timestamp with time zone NOT NULL,

  -- SHA-256 hex del payload normalizado enviado por CRM.
  payload_hash                    varchar(64) NOT NULL,

  -- RECEIVED / CREATING_PAYMENTS / PAYMENTS_CREATED / APPLYING / APPLIED /
  -- RETRYABLE_ERROR / REVIEW_REQUIRED.
  status                          text NOT NULL DEFAULT 'RECEIVED',
  processing_started_at           timestamp with time zone,
  payments_created_at             timestamp with time zone,
  applied_at                      timestamp with time zone,
  retry_count                     integer NOT NULL DEFAULT 0,
  last_error_code                 text,
  last_error_message              text,
  created_at                      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                      timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT pagalo_payment_imports_crm_group_uq UNIQUE (crm_group_id),
  CONSTRAINT pagalo_payment_imports_capital_tx_uq UNIQUE (capital_transaction_uuid),
  CONSTRAINT pagalo_payment_imports_facturable_tx_uq UNIQUE (facturable_transaction_uuid),
  CONSTRAINT pagalo_payment_imports_capital_external_uq UNIQUE (capital_external_identifier),
  CONSTRAINT pagalo_payment_imports_facturable_external_uq UNIQUE (facturable_external_identifier),
  CONSTRAINT pagalo_payment_imports_status_chk CHECK (
    status IN (
      'RECEIVED', 'CREATING_PAYMENTS', 'PAYMENTS_CREATED', 'APPLYING',
      'APPLIED', 'RETRYABLE_ERROR', 'REVIEW_REQUIRED'
    )
  ),
  CONSTRAINT pagalo_payment_imports_amounts_chk CHECK (
    capital_total > 0 AND facturable_total > 0 AND total_amount > 0
  ),
  CONSTRAINT pagalo_payment_imports_total_matches_chk CHECK (
    total_amount = capital_total + facturable_total
  ),
  CONSTRAINT pagalo_payment_imports_payload_hash_chk CHECK (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT pagalo_payment_imports_transactions_different_chk CHECK (
    capital_transaction_uuid <> facturable_transaction_uuid
  ),
  CONSTRAINT pagalo_payment_imports_external_ids_different_chk CHECK (
    capital_external_identifier <> facturable_external_identifier
  ),
  CONSTRAINT pagalo_payment_imports_retry_count_chk CHECK (retry_count >= 0)
);

COMMENT ON TABLE cartera.pagalo_payment_imports IS
  'Ledger idempotente por grupo CRM. Contiene dos ACCEPT Págalo y relaciona N pagos_credito.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.crm_group_id IS
  'ID de pagalo_payment_groups en CRM. UNIQUE evita doble aplicación por retry/timeout.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.payload_hash IS
  'SHA-256 del payload normalizado; mismo grupo con hash distinto requiere revisión.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.capital_request_auth IS
  'Código de autorización de transacción CAPITAL; no credencial Págalo.';
COMMENT ON COLUMN cartera.pagalo_payment_imports.facturable_request_auth IS
  'Código de autorización de transacción MORA_INTERES; no credencial Págalo.';

CREATE INDEX IF NOT EXISTS pagalo_payment_imports_status_idx
  ON cartera.pagalo_payment_imports(status, updated_at);
CREATE INDEX IF NOT EXISTS pagalo_payment_imports_credit_idx
  ON cartera.pagalo_payment_imports(credito_id, created_at);

-- Puente nullable a pagos reales; una importación puede cubrir N cuotas.
ALTER TABLE cartera.pagos_credito
  ADD COLUMN IF NOT EXISTS pagalo_import_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pagos_credito_pagalo_import_fk'
      AND conrelid = 'cartera.pagos_credito'::regclass
  ) THEN
    ALTER TABLE cartera.pagos_credito
      ADD CONSTRAINT pagos_credito_pagalo_import_fk
      FOREIGN KEY (pagalo_import_id)
      REFERENCES cartera.pagalo_payment_imports(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN cartera.pagos_credito.pagalo_import_id IS
  'Importación Págalo padre. Varias cuotas compartenla; NULL para pagos históricos/no Págalo.';

CREATE INDEX IF NOT EXISTS pagos_credito_pagalo_import_idx
  ON cartera.pagos_credito(pagalo_import_id);

-- INVARIANTES DEL SERVICIO
-- ============================================================================
-- 1. Ambos UUIDs corresponden a ACCEPT y montos coinciden con cabecera.
-- 2. Moneda de ambos links coincide con currency.
-- 3. Antes de INSERT, lock + búsqueda en ambas columnas evita cruce de rol.
-- 4. Retry de crm_group_id exige mismo payload_hash.
-- 5. Pagos nuevos usan pagalo_import_id y origen_pago='pagalo'.
-- 6. APPLIED solo cuando todas filas relacionadas quedaron aplicadas.
-- 7. Estado parcial/ambigüedad pasa REVIEW_REQUIRED, nunca retry ciego.
