// Ruta relativa y no el alias `@/`: `bun test` no resuelve los alias de vite, y
// este módulo existe para ser testeable fuera del componente.
import { sumaQ } from "../../../lib/moneda";

export type TerminosDelTotal = {
  /** Mora activa. El endpoint la manda como STRING cuando hay y como 0 cuando no. */
  mora: number;
  /** Saldo vivo de los cobros adicionales del crédito. */
  rubros: number;
  /** Cuota del convenio a pagar. Ver la nota de abajo: se suma aunque no consuma. */
  convenio: number;
  /** Cuota del mes, con el ajuste por fecha ideal ya incluido. */
  cuota: number;
  /** Lo que ya se abonó a esa cuota y por lo tanto no hay que volver a pedir. */
  abonosParciales: number;
  /** `otros` del FORMULARIO: plata que el asesor agrega, no una obligación del crédito. */
  otros: number;
  /** `abono_directo_capital` del FORMULARIO. */
  abonoDirectoCapital: number;
};

/**
 * Cuánto pedirle al cliente para que la boleta alcance a cubrir todo lo que la
 * pantalla le está mostrando.
 *
 * Es UNA cifra y por eso tiene que contemplar todo lo que el motor se lleva
 * antes de la cuota: si le falta un término, el asesor cobra de menos, la cuota
 * queda corta y el cliente ya se fue.
 *
 * **Los dos campos del FORMULARIO entran, y son hermanos**: el motor arranca con
 * `boleta − otros − abonoDirectoCapital` (`calcularMontoEfectivo`), o sea que los
 * dos salen de la misma línea y de ese resto recién salen mora, rubros y la
 * cuota. Sumar sólo uno deja el otro abierto con el mismo faltante. Con cuota
 * Q1,000, rubros Q300 y otros Q100, cobrar Q1,300 deja Q900 para la cuota.
 *
 * No hay doble conteo con el `otros` del crédito: el `otros` del formulario
 * arranca en 0 y no se prellena, y `rubros` es el módulo nuevo `cartera.rubros`,
 * no la tabla vieja `creditos_rubros_otros` que alimenta esa columna. Que el
 * cobro de rubros se ESCRIBA después en la columna `otros` del pago es reúso de
 * columna al commitear, no el campo del request.
 *
 * ⚠️ **El saldo a favor NO se resta**, y es correcto: `calcularMontoEfectivo`
 * recibe el parámetro y lo descarta.
 *
 * ⚠️ **El convenio SÍ se suma aunque no consuma la boleta.** Es herencia
 * deliberada —la tarjeta viene pidiendo cuota + convenio desde antes de este
 * módulo y el umbral de excedente del hook lo espeja a propósito—, así que el
 * total pide de más cuando hay convenio. Queda como decisión de producto
 * pendiente; cambiarlo acá descuadraría el umbral.
 *
 * `sumaQ` suma en centavos enteros para no descuadrar contra el `Big` del
 * backend, y descarta lo no numérico en vez de envenenar el total con NaN.
 */
export function calcularTotalACobrar(t: TerminosDelTotal): number {
  return Math.max(
    0,
    sumaQ([
      Number(t.mora ?? 0),
      Number(t.rubros ?? 0),
      Number(t.convenio ?? 0),
      Number(t.cuota ?? 0),
      Number(t.otros ?? 0),
      Number(t.abonoDirectoCapital ?? 0),
      -Number(t.abonosParciales ?? 0),
    ])
  );
}
