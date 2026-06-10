-- Crédito solo-interés: cuando no_amortiza_capital = true, la cuota cubre
-- interés + IVA + seguro + GPS + membresía, sin amortizar capital. El capital
-- se paga vía abonos extraordinarios o pago final.
ALTER TABLE cartera.creditos
ADD COLUMN IF NOT EXISTS no_amortiza_capital boolean NOT NULL DEFAULT false;
