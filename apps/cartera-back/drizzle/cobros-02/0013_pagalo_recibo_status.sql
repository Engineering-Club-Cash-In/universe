-- 0013 · Págalo — outbox mínimo del recibo por WhatsApp post-commit
-- ============================================================================
--
-- D-10 v2: el recibo se manda después del commit. Si cartera muere entre el
-- commit y el envío, un replay del dispatcher (idempotente por crm_group_id)
-- o el barrido de 10 min lo reanudan; ENVIANDO es el claim atómico de quien
-- lo está mandando; un FALLIDA se reintenta hasta 5 veces, solo para los
-- pagos que aún no recibieron su recibo (hallazgos Codex, PR #1468).

BEGIN;

ALTER TABLE cartera.pagalo_payment_imports
  ADD COLUMN IF NOT EXISTS recibo_status text,
  ADD COLUMN IF NOT EXISTS recibo_at timestamptz,
  -- reintentos acotados de un recibo FALLIDA (caída transitoria de PDF/CRM)
  ADD COLUMN IF NOT EXISTS recibo_intentos integer NOT NULL DEFAULT 0,
  -- JSON array de pago_id cuyo recibo ya salió: el reintento manda solo los que faltan
  ADD COLUMN IF NOT EXISTS recibo_pagos_ok text;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_recibo_status_chk;

ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_recibo_status_chk CHECK (
    recibo_status IS NULL
    OR recibo_status IN ('PENDIENTE', 'ENVIANDO', 'OK', 'FALLIDA')
  );

COMMIT;
