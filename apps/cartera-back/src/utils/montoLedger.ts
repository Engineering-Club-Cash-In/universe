import Big from "big.js";

/**
 * Funciones puras para el ledger de mora. Viven aparte de anotarMoraPagada para
 * que los tests puedan usarlas incluso cuando otra suite mockea anotarMoraPagada.
 */

/**
 * Formato de un monto en el ledger: 6 decimales, no centavos. Redondear cada
 * fila a centavos deja restos por cuota que el cron termina cobrando como
 * Q0.01 (ver la nota de la migración 0043).
 */
export function montoParaLedger(monto: Big): string {
  return monto.toFixed(6);
}

/**
 * Las anotaciones tal como se van a guardar: cada monto a 6 decimales, y se
 * descartan las que se guardarían en cero.
 *
 * Se filtra por lo que se va a GUARDAR (6 decimales), no por el Big completo:
 * un resto que redondea a 0.000000 rompería el CHECK `monto <> 0`.
 */
export function anotacionesAGuardar<T extends { monto: Big | string | number }>(
  filas: T[],
): Array<T & { montoBig: Big }> {
  return filas
    .map((f) => ({ ...f, montoBig: new Big(montoParaLedger(new Big(f.monto || 0))) }))
    .filter((f) => f.montoBig.gt(0));
}
