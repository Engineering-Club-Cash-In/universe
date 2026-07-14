-- VARIANTE 2 del plazo del inversionista (paso 1: solo registrar).
--
-- Cuando el inversionista tiene plazo propio (creditos_inversionistas_espejo.
-- plazo_inversionista), su capital debería amortizar como cuota nivelada
-- (sistema francés, igual que la calculadora de inversión) sobre SU monto y
-- SU plazo — no al ritmo del crédito. Esta columna guarda, por cada pago
-- espejo generado:
--
--   diferencia = amortizacion_real_del_mes − abono_capital
--
--   amortizacion_real_del_mes = cuota_nivelada(monto_espejo, tasa×1.12, plazo)
--                               − monto_espejo × tasa × 1.12
--
-- Es la parte de la amortización que el crédito NO cubrió este mes; más
-- adelante se restará del monto_aportado del espejo y CUBE comprará esa
-- porción. Por ahora SOLO se persiste (ni resta ni compra de CUBE).
-- NULL = el inversionista no tiene plazo propio. Nunca negativa (clamp a 0).
-- Cartera aplica el SQL a mano (no drizzle-kit).

ALTER TABLE cartera.pagos_credito_inversionistas_espejo
  ADD COLUMN IF NOT EXISTS diferencia_amortizacion_plazo numeric(18, 2);
