import Big from "big.js";
import {
  calcularCoberturaCuota,
  sumarAplicadoACuota,
  type PagoCoberturaCuota,
  type RubrosCuotaRow,
} from "./registerPaymentPolicy";
import {
  buildInstallmentRemainderReplication,
  type ReplicaRestantesCuota,
} from "./reversePaymentPolicy";

type BigInput = number | string | Big;

/**
 * ¿Anular (`falsePayment`) un pago obliga a REABRIR la cuota a la que aportó?
 *
 * `insertPayment` estampa en TODAS las filas vivas de la cuota dos cosas: el
 * `pagado = true` (cuando el pago la completa) y los `*_restante` ya descontados.
 * `falsePayment` solo invalida la fila del pago, así que si la cuota tenía un
 * parcial previo, esa hermana se quedaba con `pagado = true` y restantes en 0:
 * el cron la veía cubierta (la mora se dejaba de cobrar) y el pago siguiente se
 * saltaba la cuota. `reversePayment` ya lo resuelve con
 * `buildInstallmentRemainderReplication`; esta regla reusa esa pieza y el mismo
 * criterio de cobertura de `insertPayment` (`calcularCoberturaCuota`, con
 * pendientes: `insertPayment` marca `pagado` aun con el cierre pendiente).
 *
 * No hace nada cuando:
 *  - la fila anulada no cuelga de una cuota o no le aportó nada (solo mora /
 *    otros / convenio: cuelgan de la primera cuota pendiente sin pagarla);
 *  - las hermanas vivas cubren la cuota solas (no se reabre lo que ya estaba
 *    pagado sin este pago);
 *  - el crédito está cerrado (CANCELADO / PENDIENTE_CANCELACION).
 *
 * INCOBRABLE: se reponen restantes y filas, pero `cuotas_credito.pagado` no se
 * toca (la cuota de un castigado se cierra por capital, como en la reversa).
 */
export type RestantesFila = {
  capital_restante?: BigInput | null;
  interes_restante?: BigInput | null;
  iva_12_restante?: BigInput | null;
  seguro_restante?: BigInput | null;
  gps_restante?: BigInput | null;
  membresias?: BigInput | null;
};

export type FilaAnulada = RubrosCuotaRow &
  RestantesFila & { cuota_id?: number | null };

export type PlanReaperturaCuota = {
  /** Restantes a estampar en las filas vivas de la cuota (null: no tocar). */
  replica: ReplicaRestantesCuota | null;
  /** Poner `pagado = false` en las filas vivas de la cuota. */
  reabrirFilas: boolean;
  /** Poner `cuotas_credito.pagado = false`. */
  reabrirCuota: boolean;
};

const SIN_CAMBIOS: PlanReaperturaCuota = {
  replica: null,
  reabrirFilas: false,
  reabrirCuota: false,
};

const ESTADOS_CERRADOS = ["CANCELADO", "PENDIENTE_CANCELACION"];

const masAbono = (restante?: BigInput | null, abono?: BigInput | null) =>
  new Big(restante ?? 0).plus(abono ?? 0);

export function planReaperturaCuotaPorAnulacion({
  creditoId,
  montoCuota,
  statusCredit,
  filaAnulada,
  hermanas,
}: {
  creditoId: number;
  montoCuota: BigInput | null | undefined;
  statusCredit?: string | null;
  filaAnulada: FilaAnulada;
  /** Filas de la cuota que NO son la anulada (las anuladas las ignora la cobertura). */
  hermanas: PagoCoberturaCuota[];
}): PlanReaperturaCuota {
  const cuotaId = filaAnulada.cuota_id;
  if (cuotaId === null || cuotaId === undefined) return SIN_CAMBIOS;
  if (new Big(montoCuota ?? 0).lte(0)) return SIN_CAMBIOS;
  if (statusCredit && ESTADOS_CERRADOS.includes(statusCredit)) return SIN_CAMBIOS;

  const aplicadoALaCuota = sumarAplicadoACuota([filaAnulada]);
  if (aplicadoALaCuota.lte(0)) return SIN_CAMBIOS;

  const conPendientes = calcularCoberturaCuota({
    montoCuota: montoCuota!,
    pagos: hermanas,
    incluirPendientes: true,
  });
  if (conPendientes.cuotaCompleta) return SIN_CAMBIOS;

  const replica = buildInstallmentRemainderReplication({
    cuotaId,
    creditoId,
    restantes: {
      capital: masAbono(filaAnulada.capital_restante, filaAnulada.abono_capital),
      interes: masAbono(filaAnulada.interes_restante, filaAnulada.abono_interes),
      iva: masAbono(filaAnulada.iva_12_restante, filaAnulada.abono_iva_12),
      seguro: masAbono(filaAnulada.seguro_restante, filaAnulada.abono_seguro),
      gps: masAbono(filaAnulada.gps_restante, filaAnulada.abono_gps),
      membresias: masAbono(filaAnulada.membresias, filaAnulada.membresias_pago),
    },
    aplicadoALaCuota,
    filaAnulada: false,
  });

  const sinPendientes = calcularCoberturaCuota({
    montoCuota: montoCuota!,
    pagos: hermanas,
  });

  return {
    replica,
    reabrirFilas: true,
    reabrirCuota: statusCredit !== "INCOBRABLE" && !sinPendientes.cuotaCompleta,
  };
}
