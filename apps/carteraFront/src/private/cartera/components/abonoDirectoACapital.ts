// Ruta relativa y no el alias `@/`: `bun test` no resuelve los alias de vite, y
// este módulo existe para ser testeable fuera del hook.
import { sumaQ } from "../../../lib/moneda";

/**
 * Cuánto de la boleta puede ir a `abono_directo_capital`.
 *
 * **Es la boleta MENOS `otros`, no la boleta entera**, y la diferencia era un
 * descuadre que llegaba a la base: `otros` es una columna de la fila del pago y
 * se guarda tal como vino, así que mandando la boleta completa a capital una
 * boleta de Q1,100 con Q100 de otros quedaba con Q1,100 de capital MÁS Q100 de
 * otros — Q1,200 asignados contra un comprobante de Q1,100.
 *
 * Y no se compensa por ningún lado: el efectivo del motor
 * (`boleta − otros − abono directo`) queda en −100, así que el bloque que
 * acredita saldo a favor tampoco corre. La plata fantasma es neta. Peor: el
 * `otros` se factura solo como «GASTOS VARIOS» y el capital no, así que el
 * descuadre sale a un DTE.
 *
 * No es una decisión nueva: el hermano `handleAbonoCapital` —la vía del modal de
 * exceso— ya calcula su monto a partir de `boleta − otros − mora`. La semántica
 * "el capital sale de lo que queda después de otros" estaba decidida y en
 * producción; `handleAbonoCapitalDirecto` era la asimetría.
 *
 * Piso en cero: si `otros` se come la boleta, a capital no va nada. Un negativo
 * sería pedirle plata al crédito.
 *
 * ⚠️ Efecto observable del cambio, a propósito: con `otros > 0` el efectivo pasa
 * de negativo a CERO, así que `esPagoSoloCapital` da `true` y el request se
 * saltea el guard de "todas las cuotas abiertas cubiertas". Es la semántica
 * correcta para un pago de sólo capital —y la que pide el docstring de ese
 * predicado—, pero es un cambio de conducta en los INCOBRABLES con `otros`.
 */
export function montoParaAbonoDirectoACapital(entrada: {
  boleta: number;
  otros: number;
}): number {
  // `sumaQ` resta en centavos enteros para no descuadrar contra el `Big` del
  // backend, y descarta lo no numérico en vez de envenenar el monto.
  return Math.max(0, sumaQ([Number(entrada.boleta) || 0, -(Number(entrada.otros) || 0)]));
}
