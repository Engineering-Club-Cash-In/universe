-- 0013 · Págalo — outbox mínimo del recibo por WhatsApp post-commit
-- ============================================================================
--
-- D-10 v2: el recibo se manda después del commit. Si cartera muere entre el
-- commit y el envío, un replay del dispatcher (idempotente por crm_group_id)
-- o el barrido de 10 min lo reanudan; ENVIANDO es el claim atómico de quien
-- lo está mandando (hallazgo Codex, PR #1468).

BEGIN;

ALTER TABLE cartera.pagalo_payment_imports
  ADD COLUMN IF NOT EXISTS recibo_status text,
  ADD COLUMN IF NOT EXISTS recibo_at timestamptz;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_recibo_status_chk;

ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_recibo_status_chk CHECK (
    recibo_status IS NULL
    OR recibo_status IN ('PENDIENTE', 'ENVIANDO', 'OK', 'FALLIDA')
  );

COMMIT;
