-- Cuánto le acreditó ESTA fila al `saldo_a_favor` del usuario.
--
-- Existe porque la reversa le descontaba el `monto_boleta` COMPLETO, y eso no es
-- lo que el pago acreditó. Medido contra una copia de producción: un abono
-- directo a capital de Q1,100 con Q100 de `otros` acredita Q0 —la boleta se
-- reparte entera— y revertirlo le QUITABA Q1,000 de saldo a favor al cliente.
--
-- No se deriva de las otras columnas: en un pago mixto el disponible inicial se
-- consume después en mora, rubros y cuotas, y sólo se acredita el remanente
-- final. Reconstruirlo desde `boleta − otros − abono_capital` da el disponible
-- INICIAL y borraría saldo ajeno.
--
-- NULLABLE a propósito: las filas viejas no lo tienen y la reversa cae en la
-- conducta de antes para ellas. Poner 0 por defecto sería peor — afirmaría que
-- no acreditaron nada, y a las que sí acreditaron les impediría devolverlo.
ALTER TABLE cartera.pagos_credito
  ADD COLUMN IF NOT EXISTS saldo_a_favor_acreditado numeric(14, 2);

COMMENT ON COLUMN cartera.pagos_credito.saldo_a_favor_acreditado IS
  'Cuánto acreditó esta fila a usuarios.saldo_a_favor. NULL = fila anterior a la 0039; la reversa usa la conducta vieja.';
