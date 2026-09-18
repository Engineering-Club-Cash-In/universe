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
-- `numeric(18, 2)`, la MISMA precisión que `monto_boleta`, `abono_capital` y
-- `usuarios.saldo_a_favor`. Tiene que aguantar lo mismo que ellas: el schema del
-- request no le pone techo al monto, así que un pago que quepa en esas columnas
-- pero no en ésta reventaría al estampar la atribución — después de insertar la
-- fila, o sea un 500 que deja el pago escrito, la columna en NULL y el saldo sin
-- acreditar.
ALTER TABLE cartera.pagos_credito
  ADD COLUMN IF NOT EXISTS saldo_a_favor_acreditado numeric(18, 2);

-- En DOS pasos, y el orden es el punto: el `ADD COLUMN` de arriba va SIN default,
-- así que las filas que ya existían quedan en NULL —"anteriores a la 0039, no se
-- sabe"—, y este `SET DEFAULT` aplica sólo a las que se inserten de ahora en
-- adelante. Un `ADD COLUMN ... DEFAULT 0` de una sola vez habría rellenado también
-- las viejas, afirmando que no acreditaron nada: exactamente lo que no se sabe.
--
-- Con esto, toda fila NUEVA nace diciendo "acreditó cero" en vez de "no se sabe", y
-- eso cierra dos huecos:
--
--   * Si la transacción que acredita el saldo falla, la fila ya insertada queda en
--     0 en vez de NULL. Es el dato REAL —ese intento no acreditó nada— y la reversa
--     ya no le descuenta el `monto_boleta` completo a un pago que no dio nada.
--   * El camino NORMAL de pagos acredita saldo sin estampar esta columna. Sin el
--     default, sus filas nuevas quedaban en NULL y la reversa las trataba como
--     históricas. Ahora quedan en 0: no devuelve lo que ese camino acreditó —eso
--     sigue pendiente de atribuir bien— pero deja de sacarle al cliente plata que
--     el pago nunca le dio, que es el lado seguro del error.
ALTER TABLE cartera.pagos_credito
  ALTER COLUMN saldo_a_favor_acreditado SET DEFAULT 0;

COMMENT ON COLUMN cartera.pagos_credito.saldo_a_favor_acreditado IS
  'Cuánto acreditó esta fila a usuarios.saldo_a_favor. NULL = fila anterior a la 0039 (la reversa usa la conducta vieja); las filas nuevas nacen en 0 por DEFAULT.';
