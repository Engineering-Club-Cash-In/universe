import Big from "big.js";
import { esPagoAplicado } from "../utils/paymentStatus";
import {
  calcularCoberturaCuota,
  cuentaComoHermanoVivo,
  shouldIncobrableInstallmentBePaid,
  sumarAplicadoACuota,
  type DestinoSobrescribibleRow,
  type PagoCoberturaCuota,
  type RubrosCuotaRow,
} from "./registerPaymentPolicy";
import {
  buildInstallmentRemainderReplication,
  type ReplicaRestantesCuota,
} from "./reversePaymentPolicy";

type BigInput = number | string | Big;

export type RestantesFila = {
  capital_restante?: BigInput | null;
  interes_restante?: BigInput | null;
  iva_12_restante?: BigInput | null;
  seguro_restante?: BigInput | null;
  gps_restante?: BigInput | null;
  membresias?: BigInput | null;
};

export type FilaAnulada = RubrosCuotaRow &
  RestantesFila & {
    cuota_id?: number | null;
    validationStatus?: string | null;
    monto_aplicado?: BigInput | null;
    mora?: BigInput | null;
    otros?: string | number | null; // TEXT
    pagoConvenio?: BigInput | null;
  };

export type PlanReaperturaCuota = {
  /** Restantes a estampar en las filas vivas de la cuota (null: no tocar). */
  replica: ReplicaRestantesCuota | null;
  /** Poner `pagado = false` en las filas vivas de la cuota. */
  reabrirFilas: boolean;
  /** Poner `cuotas_credito.pagado = false`. */
  reabrirCuota: boolean;
  /**
   * La cuota se reabre y no queda ninguna fila viva de la que `insertPayment` pueda leer
   * su saldo: hay que insertar una fila `no_required` sin plata que lo lleve (como las
   * semillas de `createCredit`). Sin ella el pago siguiente se salta la cuota reabierta.
   * Si no se reabre, ningún pago la lee y una fila abierta en una cuota cerrada confunde.
   */
  insertarPortadora: boolean;
};

/**
 * 409: anular una fila stale-zero (abonos en 0, `monto_aplicado` neto = `credito.cuota`) que cerró
 * la cuota. Reabrirla con restantes en 0 deja una cuota que un pago no exacto salta (crédito 8,
 * cuota 16) y `cuotas_credito` no guarda el desglose para reconstruirla. Se tira dentro de la
 * transacción de la anulación, así que no queda nada escrito.
 */
export class AnulacionSinDesgloseError extends Error {
  readonly status = 409 as const;
  readonly code = "PAGO_SIN_DESGLOSE";
  constructor() {
    super("El pago no tiene desglose por rubro: no se puede anular automáticamente; revisalo con contabilidad");
  }
}

const SIN_CAMBIOS: PlanReaperturaCuota = {
  replica: null,
  reabrirFilas: false,
  reabrirCuota: false,
  insertarPortadora: false,
};

const masAbono = (restante?: BigInput | null, abono?: BigInput | null) =>
  new Big(restante ?? 0).plus(abono ?? 0);

/**
 * ¿Anular (`falsePayment`) un pago obliga a REABRIR la cuota a la que aportó?
 *
 * `insertPayment` estampa en TODAS las filas vivas de la cuota dos cosas: el
 * `pagado = true` (cuando el pago la deja sin restantes, ver
 * `shouldMarkInstallmentPaymentPaid`) y los `*_restante` ya descontados.
 * `falsePayment` solo invalida la fila del pago, así que si la cuota tenía un
 * parcial previo, esa hermana se quedaba con `pagado = true` y restantes en 0:
 * el cron la veía cubierta (la mora se dejaba de cobrar) y el pago siguiente se
 * saltaba la cuota. `reversePayment` ya lo resuelve; esta regla reusa su
 * réplica de restantes (reversePayment.ts ~610-646) y su recálculo de `pagado`
 * (~926-1008). Para saber si las hermanas cubren la cuota usa
 * `calcularCoberturaCuota` con pendientes, el mismo criterio de suma por rubros
 * de `insertPayment` y de la anti-sobreaplicación. Hermanas vivas que cubren:
 * validated, pending y `no_required` con plata (ver abajo).
 *
 * No hace nada cuando:
 *  - la fila anulada no cuelga de una cuota o no le aportó nada (solo mora /
 *    otros / convenio: cuelgan de la primera cuota pendiente sin pagarla);
 *  - las hermanas vivas cubren la cuota solas (no se reabre lo que ya estaba
 *    pagado sin este pago), salvo en INCOBRABLE, que decide por capital.
 *
 * Si la fila aportó y las hermanas no cubren, los restantes SIEMPRE se reponen
 * (como en la reversa: no dependen del estado del crédito ni de `credito.cuota`).
 * El estado decide solo el `pagado`:
 *  - `cuota <= 0`: no hay contra qué medir, no se reabre.
 *  - CANCELADO: no se reabre; es terminal (`desactivarNexaPorCancelacion`, no se
 *    reactiva) y el cron lo excluye. PENDIENTE_CANCELACION SÍ se reabre: `ACTIVAR`
 *    lo devuelve a ACTIVO sin tocar cuotas ni pagos.
 *  - CAIDO: igual que CANCELADO; `fallenCredits` conserva solo la cuota 0 (ancla)
 *    y `updateCredit` lo trata como finalizado. Los restantes sí se reponen.
 *  - INCOBRABLE: como `reversePayment` (~967-1005), filas y cuota quedan con el
 *    mismo valor, el de `shouldIncobrableInstallmentBePaid` (por capital).
 */
export function planReaperturaCuotaPorAnulacion({
  creditoId,
  montoCuota,
  statusCredit,
  capital,
  filaAnulada,
  hermanas,
}: {
  creditoId: number;
  montoCuota: BigInput | null | undefined;
  statusCredit?: string | null;
  /** `creditos.capital`: solo lo usa INCOBRABLE para decidir si la cuota está pagada. */
  capital?: BigInput | null;
  filaAnulada: FilaAnulada;
  /** Filas de la cuota que NO son la anulada (las anuladas las ignora la cobertura). */
  hermanas: (PagoCoberturaCuota & DestinoSobrescribibleRow)[];
}): PlanReaperturaCuota {
  const cuotaId = filaAnulada.cuota_id;
  if (cuotaId === null || cuotaId === undefined) return SIN_CAMBIOS;

  // Un abono directo a capital queda fuera de la lógica de cuota (registerPayment.ts ~4244-4250):
  // `sumarAplicadoACuota` suma su `abono_capital`, pero no le aportó nada a la cuota.
  if (
    filaAnulada.validationStatus === "capital" ||
    filaAnulada.validationStatus === "capital_validated" ||
    // Fila estructural del cierre/castigo: como la reversa, no es una recuperación.
    // Las hermanas reset siguen contando como vivas.
    filaAnulada.validationStatus === "reset"
  ) {
    return SIN_CAMBIOS;
  }

  const cuota = new Big(montoCuota ?? 0);
  // Vía stale-zero (registerPayment.ts ~1696-1708): con los restantes ya en 0, el pago exacto de la
  // cuota sube `monto_aplicado` sin repartir rubros. Solo si el neto es justo `credito.cuota` (los
  // sobrantes legados con abonos en 0, 552/111135, no saldaron nada y siguen sin cambios); si la
  // cuota se reabriría, se rechaza (ver `AnulacionSinDesgloseError`).
  const otros = String(filaAnulada.otros ?? "").trim();
  const netoStaleZero = new Big(filaAnulada.monto_aplicado ?? 0)
    .minus(filaAnulada.mora ?? 0)
    .minus(/^-?\d+(\.\d+)?$/.test(otros) ? otros : 0)
    .minus(filaAnulada.pagoConvenio ?? 0);
  const esStaleZero =
    [filaAnulada.abono_capital, filaAnulada.abono_interes, filaAnulada.abono_iva_12,
      filaAnulada.abono_seguro, filaAnulada.abono_gps, filaAnulada.membresias_pago]
      .every((a) => new Big(a ?? 0).eq(0)) &&
    cuota.gt(0) &&
    // Filas viejas guardaban `monto_aplicado` bruto (con mora/otros dentro): vale bruto o neto.
    (netoStaleZero.minus(cuota).abs().lte(0.01) ||
      new Big(filaAnulada.monto_aplicado ?? 0).minus(cuota).abs().lte(0.01));
  const aplicadoALaCuota = esStaleZero ? cuota : sumarAplicadoACuota([filaAnulada]);
  if (aplicadoALaCuota.lte(0)) return SIN_CAMBIOS;

  // `no_required` con plata es un pago real (SIFCO; Caja vía /editPayment, crédito 890):
  // `insertPayment` la netea con este mismo predicado y el cron la cuenta como cobertura
  // (cuotaYaPagadaSql). Las semillas vacías no cuentan. Solo vale dentro de esta regla:
  // `calcularCoberturaCuota` la comparten Nexa, la revalidación y la boleta tardía.
  const cubrientes = hermanas.map((h) =>
    h.validationStatus === "no_required" && cuentaComoHermanoVivo(h)
      ? { ...h, validationStatus: "validated" }
      : h,
  );
  // INCOBRABLE se rige por el capital, no por la suma: las filas estructurales del castigo
  // (system_reset) la contaminan (registerPaymentPolicy ~1051-1061, crédito 23). Como
  // reversePayment (~964-983), sin atajo: siempre repone y decide `pagado` con capitalPrevio.
  if (
    statusCredit !== "INCOBRABLE" &&
    cuota.gt(0) &&
    calcularCoberturaCuota({ montoCuota: cuota, pagos: cubrientes, incluirPendientes: true })
      .cuotaCompleta
  ) {
    return SIN_CAMBIOS;
  }

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

  // Solo el `pagado` depende de la cuota y del estado (ver el bloque de arriba).
  // `capital` es el de `creditos` con el abono del pago todavía restado (la validación lo
  // restó): se evalúa con el capital de ANTES del pago, como `reversePayment` (~375-396),
  // y solo si el pago estaba aplicado. Un pending nunca descontó capital.
  const capitalPrevio = new Big(capital ?? 0).plus(
    esPagoAplicado(filaAnulada.validationStatus) ? (filaAnulada.abono_capital ?? 0) : 0,
  );
  const incobrablePagada = shouldIncobrableInstallmentBePaid({
    statusCredit,
    capital: capitalPrevio.toString(),
    abonoCapital: 0,
  });
  const reabrir =
    cuota.gt(0) && statusCredit !== "CANCELADO" &&
    statusCredit !== "CAIDO" &&
    incobrablePagada !== true;
  if (esStaleZero) {
    if (reabrir) throw new AnulacionSinDesgloseError();
    return SIN_CAMBIOS;
  }

  // `insertPayment` toma el saldo vigente de filas validated / pending / no_required vivas
  // (registerPayment.ts ~1262-1370); las de capital no sirven. Sin ninguna, lee 0.
  const hayDondeLeerSaldo = hermanas.some(
    (h) =>
      h.paymentFalse !== true &&
      ["no_required", "validated", "pending"].includes(h.validationStatus ?? ""),
  );

  return {
    replica,
    reabrirFilas: reabrir,
    reabrirCuota: reabrir,
    insertarPortadora: replica !== null && !hayDondeLeerSaldo && reabrir,
  };
}
