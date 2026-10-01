import Big from "big.js";

// Tasa mensual de mora (1.12%). En la fila de moras_credito el porcentaje se
// sigue guardando como "1.12" — esta es la misma tasa en forma decimal.
export const TASA_MORA_MENSUAL = "0.0112";

// Base FIJA de 30 días (no los días calendario del mes): negocio quiere que el
// cargo de una cuota sea el mismo sin importar si cayó en febrero o en julio.
export const BASE_DIAS_MORA = 30;


/**
 * Mora proporcional a los días de atraso: por CADA cuota vencida se cobra
 * capital × 1.12% × (días/30), con TECHO de un cargo mensual completo por cuota.
 *
 * El techo es lo que evita que la cartera vieja se dispare: antes una cuota
 * vencida hace 365 días cobraba lo mismo que una de 30 (un bloque fijo), y sin
 * el min(1,·) ahora cobraría 12 veces más. Con el techo, atrasarse 1 día cuesta
 * 1/30 del cargo y atrasarse un año cuesta exactamente 1 cargo.
 *
 * Devuelve un Big SIN redondear: el .toFixed(2) va solo al final, para que
 * redondear los factores intermedios no corra el total centavo a centavo.
 */
export function calcularMoraProporcional(params: {
  capital: Big | string | number;
  diasAtrasadosPorCuota: number[];
}): Big {
  const capital = new Big(params.capital || 0);
  if (capital.lte(0) || params.diasAtrasadosPorCuota.length === 0) return new Big(0);

  const cargoMensual = capital.times(TASA_MORA_MENSUAL);

  return params.diasAtrasadosPorCuota.reduce((acc, diasRaw) => {
    const dias = Math.max(0, diasRaw);
    // big.js no tiene Big.min, así que el techo se hace con una comparación.
    const factor = dias >= BASE_DIAS_MORA ? new Big(1) : new Big(dias).div(BASE_DIAS_MORA);
    return acc.plus(cargoMensual.times(factor));
  }, new Big(0));
}
