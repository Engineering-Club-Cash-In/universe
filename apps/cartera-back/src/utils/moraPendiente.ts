import Big from "big.js";
import { calcularMoraProporcional } from "./moraFormula";

export type CuotaParaPendiente = {
  cuota_id: number;
  /** Días de atraso de ESTA cuota. Negativo o cero ⇒ no devenga. */
  diasAtraso: number;
  /** Lo que YA se le abonó de mora a esta cuota. Nunca negativo. */
  pagado: Big | string | number;
};

export type PendienteDeCuota = {
  cuota_id: number;
  devengado: Big;
  pagado: Big;
  pendiente: Big;
};

/**
 * Calcula la mora pendiente (no cobrada) por cuota.
 *
 * La regla clave: el `pendiente` de cada cuota se calcula como
 * `max(0, devengado - pagado)`, **por cuota**. Esto evita que el sobrante
 * pagado de una cuota le reduzca el pendiente a otra (que es lo que pasaría
 * si hiciéramos `max(0, Σdevengado - Σpagado)`).
 *
 * Así, si una cuota ya está sobrepagada de mora, su pendiente es cero
 * y el cliente no le paga su mora a la siguiente.
 *
 * @param params.capital - Monto de capital del crédito (Big | string | number)
 * @param params.cuotas - Array de cuotas con días de atraso y pagado
 * @returns { total, porCuota[] } — el pendiente total y el desglose por cuota
 */
export function moraPendientePorCuota(params: {
  capital: Big | string | number;
  cuotas: CuotaParaPendiente[];
}): { total: Big; porCuota: PendienteDeCuota[] } {
  const capital = new Big(params.capital || 0);
  const porCuota: PendienteDeCuota[] = [];

  for (const cuota of params.cuotas) {
    // Calcular devengado de esta cuota usando la fórmula centralizada
    // capital × TASA_MORA_MENSUAL × min(1, dias/30).
    // Sin redondear: con lo pagado en 0 el total es EXACTAMENTE el de antes
    // del ledger (mismos términos, mismo orden). Los restos de fracción que deja
    // la escala de 6 decimales del ledger los filtra `anotarMoraPagada`.
    const devengado = calcularMoraProporcional({
      capital,
      diasAtrasadosPorCuota: [cuota.diasAtraso],
    });

    const pagadoBig = new Big(cuota.pagado || 0);

    // pendiente = max(0, devengado - pagado), **por cuota**
    const diff = devengado.minus(pagadoBig);
    const pendiente = diff.gte(0) ? diff : new Big(0);

    porCuota.push({
      cuota_id: cuota.cuota_id,
      devengado,
      pagado: pagadoBig,
      pendiente,
    });
  }

  // Total = suma de los pendientes, no max(0, Σdevengado - Σpagado)
  const total = porCuota.reduce((acc, c) => acc.plus(c.pendiente), new Big(0));

  return { total, porCuota };
}

export type RepartoDeMora = { cuota_id: number; monto: Big };

/**
 * Reparte un monto de pago de mora entre cuotas.
 *
 * El reparto respeta el ORDEN en que vienen las cuotas: quien llama decide
 * si es por vencimiento, por id, o cualquier otro criterio. Esta función
 * solo distribuye de arriba hacia abajo.
 *
 * Reglas:
 *  - A cada cuota se le abona **como mucho su `pendiente`**.
 *  - Lo que no alcanzó a repartirse es el `sobrante`.
 *  - No se emiten filas de monto cero: si a una cuota le toca cero, no aparece.
 *  - Si el monto es 0 o negativo, el reparto es vacío y sobrante = monto tal cual.
 *
 * @param params.monto - Monto a repartir (Big | string | number)
 * @param params.porCuota - Array de cuotas ya calculadas, EN EL ORDEN A COBRAR
 * @returns { reparto[], sobrante }
 */
export function repartirPagoDeMora(params: {
  monto: Big | string | number;
  /** Las cuotas ya calculadas por `moraPendientePorCuota`, EN EL ORDEN EN QUE SE DEBEN COBRAR. */
  porCuota: PendienteDeCuota[];
}): { reparto: RepartoDeMora[]; sobrante: Big } {
  let pendiente = new Big(params.monto || 0);
  const reparto: RepartoDeMora[] = [];

  // Si el monto es 0 o negativo, no hay nada que repartir.
  if (pendiente.lte(0)) {
    return { reparto: [], sobrante: pendiente };
  }

  for (const cuota of params.porCuota) {
    if (pendiente.lte(0)) {
      // Se acabó el dinero.
      break;
    }

    // A esta cuota le abonamos como mucho su pendiente.
    const abonar = pendiente.lte(cuota.pendiente) ? pendiente : cuota.pendiente;

    if (abonar.gt(0)) {
      reparto.push({
        cuota_id: cuota.cuota_id,
        monto: abonar,
      });
    }

    pendiente = pendiente.minus(abonar);
  }

  return { reparto, sobrante: pendiente };
}
