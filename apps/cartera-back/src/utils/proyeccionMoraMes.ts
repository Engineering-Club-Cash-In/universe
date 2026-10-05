import Big from "big.js";
import { STATUS_EXCLUIDOS_MORA } from "../constants/creditStatus";
import { DIAS_PAGO_PENDIENTE_FRENA_MORA } from "./cuotaYaPagadaSql";
import { moraPendientePorCuota } from "./moraPendiente";

/**
 * La mora que el cron dejaría CADA DÍA de aquí a fin de mes si el cliente no
 * paga nada más: el cron corre a las 00:05 de Guatemala y calcula con ese día
 * como «hoy», así que el valor del día d es el de la corrida de las 00:05 de d. Es la mitad «futuro» de la proyección que ve el asesor en el
 * caso de cobros; los días ya pasados no se calculan acá, salen del historial.
 *
 * No trae fórmula propia: por cada día arma las cuotas que el cron miraría ese
 * día y se las pasa a `moraPendientePorCuota`, la misma función con la que
 * el cron cobra. Lo único que este módulo decide es QUÉ cuotas entran cada día
 * y con cuántos días de atraso.
 *
 * Todas las fechas son `YYYY-MM-DD` del calendario de Guatemala: acá no hay
 * instantes ni zonas, solo días que se restan.
 */
export type CuotaParaProyeccion = {
  cuota_id: number;
  /** Vencimiento de la cuota. Debe estar IMPAGA (`cuotas_credito.pagado = false`). */
  fecha_vencimiento: string;
  /** Lo ya abonado o condonado de mora a esta cuota (`mora_pagada_cuota`). */
  pagado: Big | string | number;
  /** Tiene un pago validado (o que no requiere validación) que la cubre: no genera mora. */
  cubiertaPorPagoValidado?: boolean;
  /** `fecha_pago` de sus pagos PENDIENTES de validación (frenan la mora unos días). */
  fechasPagoPendiente?: string[];
};

export type DiaProyectado = {
  fecha: string;
  /** Lo que el cron escribe a las 00:05 de ese día (se redondea el total, no cada cuota). */
  mora: string;
  /** Cuotas que al día siguiente deberán más que ese día. */
  cuotasSumando: number;
};

const DIA_MS = 86_400_000;

/** Número de día de una fecha `YYYY-MM-DD` (NaN si no tiene esa forma). */
function numeroDeDia(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DIA_MS : NaN;
}

const fechaDeDia = (dia: number) => new Date(dia * DIA_MS).toISOString().slice(0, 10);

/** Último día (`YYYY-MM-DD`) del mes al que pertenece `fecha`. */
export function ultimoDiaDelMes(fecha: string): string {
  const d = new Date(numeroDeDia(fecha) * DIA_MS);
  return fechaDeDia(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / DIA_MS);
}

/**
 * ¿El cron del día `dia` (el de las 00:05) cobraría esta cuota? El criterio de
 * `isOverdueInstallmentForMora` + `hasPaidPaymentSql`, evaluado como si hoy
 * fuera `dia`: vencida ANTES de ese día (la que vence el 15 empieza el 16) y
 * sin un pago que la cubra. Un pago pendiente la cubre mientras su fecha esté
 * entre `dia − 7` y `dia + 1`; después la cuota vuelve a generar, con los días
 * contados desde el vencimiento (el freno no perdona, solo pausa).
 */
function generaMoraElDia(cuota: CuotaParaProyeccion, dia: number): boolean {
  if (cuota.cubiertaPorPagoValidado) return false;
  if (!(numeroDeDia(cuota.fecha_vencimiento) < dia)) return false;
  return !(cuota.fechasPagoPendiente ?? []).some((f) => {
    const pago = numeroDeDia(f);
    return pago >= dia - DIAS_PAGO_PENDIENTE_FRENA_MORA && pago <= dia + 1;
  });
}

export function proyectarMoraDelMes(params: {
  capital: Big | string | number | null;
  statusCredit: string | null;
  cuotas: CuotaParaProyeccion[];
  /** Hoy en Guatemala. Se proyecta desde hoy hasta el último día de SU mes. */
  hoy: string;
}): DiaProyectado[] {
  const hoy = numeroDeDia(params.hoy);
  const fin = numeroDeDia(ultimoDiaDelMes(params.hoy));
  // Sin capital o en un estado que el cron excluye no hay mora ningún día: es
  // lo que `decidirMoraDelCron` y `esCuotaElegibleParaMora` resuelven por su lado.
  const capital = new Big(params.capital || 0);
  const cobra = capital.gt(0) && !STATUS_EXCLUIDOS_MORA.includes(params.statusCredit ?? "");

  const pendienteDelDia = (dia: number) =>
    moraPendientePorCuota({
      capital,
      cuotas: (cobra ? params.cuotas : [])
        .filter((c) => generaMoraElDia(c, dia))
        .map((c) => ({
          cuota_id: c.cuota_id,
          diasAtraso: dia - numeroDeDia(c.fecha_vencimiento),
          pagado: c.pagado,
        })),
    });

  const dias: DiaProyectado[] = [];
  let delDia = pendienteDelDia(hoy);
  for (let dia = hoy; dia <= fin; dia++) {
    const siguiente = pendienteDelDia(dia + 1);
    const hoyPorCuota = new Map(delDia.porCuota.map((c) => [c.cuota_id, c.pendiente]));
    dias.push({
      fecha: fechaDeDia(dia),
      mora: delDia.total.toFixed(2),
      // Se compara lo que DEBE cada cuota y no «tiene menos de 30 días»: una
      // cuota a la que ya se le abonó más de lo que genera mañana no sube nada.
      cuotasSumando: siguiente.porCuota.filter((c) => c.pendiente.gt(hoyPorCuota.get(c.cuota_id) ?? 0))
        .length,
    });
    delDia = siguiente;
  }
  return dias;
}
