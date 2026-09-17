import Big from "big.js";

/** Las tres columnas de la fila que hacen falta para el cálculo. */
type FilaDeCapital = {
  monto_boleta: string | number | null;
  otros: string | number | null;
  abono_capital: string | number | null;
};

/**
 * Cuánto le acreditó a `saldo_a_favor` una fila de ABONO DIRECTO A CAPITAL.
 *
 * La rama de capital acredita lo que SOBRA —`boleta − otros − abono_capital`, y
 * sólo si es positivo (`if (disponible_restante.gt(0))`)—, pero la reversa le
 * descuenta el `monto_boleta` COMPLETO. Esa asimetría le arranca saldo a favor a
 * un usuario al que ese pago no le acreditó nada.
 *
 * Hasta ahora el descuadre estaba tapado por otro: la fila guardaba
 * `monto_boleta = abono_capital`, así que con `otros = 0` los dos números
 * coincidían por casualidad. Al persistir la boleta REAL —que es la que el
 * recibo imprime y la que dice el comprobante del banco— la asimetría queda a la
 * vista, y por eso las dos van juntas: arreglar una sin la otra empeora el otro
 * lado.
 *
 * Se CALCULA en vez de guardarse en una columna nueva porque los tres términos
 * ya están en la fila: menos esquema y nada que se desincronice.
 *
 * Piso en cero. Un negativo —que es lo que daba la sobreasignación vieja, con la
 * boleta entera a capital y `otros` encima— haría que revertir le SUMARA saldo a
 * favor a quien revierte.
 */
export function saldoAFavorAcreditadoPorPagoDeCapital(fila: FilaDeCapital): Big {
  const sobrante = new Big(fila.monto_boleta ?? 0)
    .minus(new Big(fila.otros ?? 0))
    .minus(new Big(fila.abono_capital ?? 0));

  return sobrante.gt(0) ? sobrante : new Big(0);
}

/** Los estados de una fila nacida en la rama de abono directo a capital. */
const ESTADOS_DE_CAPITAL = new Set(["capital", "capital_validated"]);

/** Si esta fila nació del abono directo a capital. */
export function esFilaDeAbonoDirectoACapital(validationStatus: string | null): boolean {
  return validationStatus !== null && ESTADOS_DE_CAPITAL.has(validationStatus);
}
