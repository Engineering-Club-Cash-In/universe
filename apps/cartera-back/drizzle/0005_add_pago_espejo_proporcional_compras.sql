-- Desglosa el interés/IVA del pago espejo cuando el inversionista entró en el
-- mes anterior y, dentro de ese mismo crédito, hizo una o varias compras
-- (tipo_operacion = 'compra_cartera', status = 'completado') en ese mes.
--
-- abono_interes_sin_compras / abono_iva_12_sin_compras:
--   Parte del monto que ya tenía en el crédito ANTES de las compras del mes
--   (cobra interés mensual completo, sin prorratear).
--
-- abono_interes_con_compras / abono_iva_12_con_compras:
--   Parte aportada por las compras nuevas del mes (cobra interés proporcional
--   por los días restantes del mes desde fecha_inicio_participacion).
--
-- abono_interes / abono_iva_12 siguen siendo la suma de ambos componentes;
-- las nuevas columnas solo dejan rastro del desglose para auditoría.
ALTER TABLE cartera.pagos_credito_inversionistas_espejo
  ADD COLUMN IF NOT EXISTS abono_interes_sin_compras NUMERIC(18, 10),
  ADD COLUMN IF NOT EXISTS abono_interes_con_compras NUMERIC(18, 10),
  ADD COLUMN IF NOT EXISTS abono_iva_12_sin_compras  NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS abono_iva_12_con_compras  NUMERIC(18, 2);
