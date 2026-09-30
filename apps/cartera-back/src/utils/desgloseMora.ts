import Big from "big.js";
import { BASE_DIAS_MORA, TASA_MORA_MENSUAL } from "./moraFormula";
import { moraPendientePorCuota } from "./moraPendiente";

/**
 * El «por qué» de la mora de un crédito, cuota por cuota, para que el asesor
 * lo pueda leer en la pantalla de cobro.
 *
 * Sale de las MISMAS funciones que usa el cron (`moraPendientePorCuota` sobre
 * las cuotas que carga `cuotasParaPendienteDeCreditos`): la explicación no
 * puede contradecir lo que se cobra.
 */
export type CuotaParaDesglose = {
  cuota_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  diasAtraso: number;
  pagado: Big | string | number;
};

export type DesgloseMora = {
  /** capital × 1.12%: lo máximo que genera UNA cuota (30 días o más). */
  cargoMensual: string;
  /** cargoMensual ÷ 30: lo que suma cada cuota por cada día de atraso. */
  cargoDiario: string;
  cuotas: {
    numero_cuota: number;
    fecha_vencimiento: string;
    dias_atraso: number;
    /** Ya llegó al tope de 30 días: no crece más. */
    topada: boolean;
    /** Tiene un pago que contabilidad no validó: el cron la sigue contando. */
    en_validacion: boolean;
    generado: string;
    abonado: string;
    pendiente: string;
  }[];
  /** Lo que el cron cobraría hoy (se redondea el total, no cada cuota). */
  total: string;
  /**
   * `total − Σ pendiente` de las filas. Cada fila se muestra cuadrada
   * (generó − pagado, en centavos) y el total es el del cron: la diferencia de
   * redondeo va en una línea explícita en vez de esconderse. Puede ser negativa.
   */
  ajusteRedondeo: string;
  /**
   * El total de mañana si el cliente no paga hoy: las cuotas vencidas con un
   * día más de atraso, MÁS las que vencen hoy (mañana tienen su primer día).
   * No puede prever pagos ni cambios de capital; por eso la pantalla dice «al
   * menos».
   */
  totalManana: string;
  /**
   * Cuántas cuotas suben mañana: las que DEBERÁN más mañana que hoy (incluye
   * las que vencen hoy). No alcanza con «menos de 30 días»: una cuota a la
   * que ya se le abonó más de lo que genera mañana no sube nada.
   */
  cuotasQueSubenManana: number;
};

export function construirDesgloseMora(params: {
  capital: Big | string | number;
  cuotas: CuotaParaDesglose[];
  numerosEnValidacion: Set<number>;
  /**
   * Cuotas sin pagar que vencen HOY: hoy no generan (el cron exige fecha de
   * vencimiento < hoy), pero mañana sí. Dejarlas afuera anunciaría un ritmo
   * menor al real, que es la dirección peligrosa (ver isInstallmentWithinMoraHorizon).
   */
  cuotasQueVencenHoy?: number;
}): DesgloseMora {
  const capital = new Big(params.capital || 0);
  const cargoMensual = capital.times(TASA_MORA_MENSUAL);
  const { porCuota, total } = moraPendientePorCuota({ capital, cuotas: params.cuotas });
  const vencenHoy = params.cuotasQueVencenHoy ?? 0;
  const manana = moraPendientePorCuota({
    capital,
    cuotas: [
      ...params.cuotas.map((c) => ({ ...c, diasAtraso: c.diasAtraso + 1 })),
      ...Array.from({ length: vencenHoy }, (_, i) => ({ cuota_id: -1 - i, diasAtraso: 1, pagado: 0 })),
    ],
  });
  const porId = new Map(porCuota.map((c) => [c.cuota_id, c]));
  const suben = manana.porCuota.filter((c) => c.pendiente.gt(porId.get(c.cuota_id)?.pendiente ?? 0)).length;
  const filas = filasDelDesglose(params.cuotas, porId, params.numerosEnValidacion);

  return {
    cargoMensual: cargoMensual.toFixed(2),
    cargoDiario: cargoMensual.div(BASE_DIAS_MORA).toFixed(2),
    cuotas: filas,
    total: total.toFixed(2),
    ajusteRedondeo: new Big(total.toFixed(2))
      .minus(filas.reduce((a, f) => a.plus(f.pendiente), new Big(0)))
      .toFixed(2),
    totalManana: manana.total.toFixed(2),
    cuotasQueSubenManana: suben,
  };
}

/** Una fila por cuota, cuadrada en centavos consigo misma. */
function filasDelDesglose(
  cuotas: CuotaParaDesglose[],
  porId: Map<number, { devengado: Big; pagado: Big }>,
  numerosEnValidacion: Set<number>,
) {
  return cuotas.map((c) => {
    const p = porId.get(c.cuota_id)!;
    // Cada fila cuadra consigo misma en centavos: debe = generó − pagado.
    const generado = new Big(p.devengado.toFixed(2));
    // Topado en lo generado: si se abonó de más (la mora se pagó con un
    // capital mayor y después bajó), mostrar el abono entero dejaría la fila
    // sin cuadrar. El excedente no se traslada a otras cuotas.
    const pagado = new Big(p.pagado.toFixed(2));
    const abonado = pagado.gt(generado) ? generado : pagado;
    const debe = generado.minus(abonado);
    return {
      numero_cuota: c.numero_cuota,
      fecha_vencimiento: c.fecha_vencimiento,
      dias_atraso: c.diasAtraso,
      topada: c.diasAtraso >= BASE_DIAS_MORA,
      en_validacion: numerosEnValidacion.has(c.numero_cuota),
      generado: generado.toFixed(2),
      abonado: abonado.toFixed(2),
      pendiente: (debe.gt(0) ? debe : new Big(0)).toFixed(2),
    };
  });
}
