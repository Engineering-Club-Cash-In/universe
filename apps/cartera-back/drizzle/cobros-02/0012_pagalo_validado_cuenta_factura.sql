-- 0012 · Págalo — el pago nace validado; cuenta de empresa PAGALO; estado de factura
-- ============================================================================
--
-- D-10 v2 / D-50 v2 (2026-08-26, Daniel): el import Págalo registra, asigna
-- cuenta, ajusta la mora y VALIDA el pago en una sola transacción; la factura
-- (SAT, irreversible) y el recibo por WhatsApp corren después del commit.
--
-- 1. Cuenta de empresa virtual para los pagos con link. `/aplicar-pago` y el
--    front exigen `pagos_credito.cuenta_empresa_id`; los pagos Págalo la
--    reciben en el mismo insert. Se resuelve por nombre (`PAGALO`, activa).
-- 2. Resultado de la facturación post-commit en el ledger, para no perder de
--    vista un pago validado cuya factura falló (playbook facturas no en SAT).

BEGIN;

INSERT INTO cartera.cuentas_empresa
  (nombre_cuenta, banco, numero_cuenta, descripcion, activo, moneda)
VALUES
  ('PAGALO', 'PAGALO', 'PAGALO-LINK',
   'Cuenta virtual: pagos con link de Págalo (bot y Ficha 360)', true, 'quetzales')
ON CONFLICT (numero_cuenta) DO NOTHING;

ALTER TABLE cartera.pagalo_payment_imports
  ADD COLUMN IF NOT EXISTS factura_status text,
  ADD COLUMN IF NOT EXISTS factura_error text,
  ADD COLUMN IF NOT EXISTS factura_at timestamptz;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_factura_status_chk;

ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_factura_status_chk CHECK (
    factura_status IS NULL
    OR factura_status IN ('PENDIENTE', 'OK', 'PARCIAL', 'FALLIDA')
  );

COMMIT;
