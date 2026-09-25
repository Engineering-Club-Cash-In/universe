import Big from "big.js";

type SameInstallmentPayment = {
  pago_id?: number | string | null;
  monto_aplicado?: string | number | null;
  monto_boleta?: string | number | null;
  validationStatus?: string | null;
  paymentFalse?: boolean | null;
  pagado?: boolean | null;
};

type RemainingPayment = {
  monto_aplicado?: string | number | null;
  validationStatus?: string | null;
  paymentFalse?: boolean | null;
};

const toBig = (value?: string | number | null) => new Big(value ?? 0);

// Estados de crédito sobre los que se permite reversar un pago.
// Incluye INCOBRABLE: aunque el crédito ya esté castigado, si se registró un
// pago por error (p. ej. el pago aún se puede crear sobre un incobrable) debe
// poder reversarse. Los estados de cierre (CANCELADO, PENDIENTE_CANCELACION,
// CAIDO) siguen bloqueados.
export const REVERSIBLE_CREDIT_STATUSES = [
  "ACTIVO",
  "MOROSO",
  "EN_CONVENIO",
  "INCOBRABLE",
] as const;

export function isCreditStatusReversible(status?: string | null) {
  return (
    status != null &&
    (REVERSIBLE_CREDIT_STATUSES as readonly string[]).includes(status)
  );
}

// `registerBy` de filas generadas por el sistema (no son recuperaciones reales):
// cierre de castigo e importaciones. Si una de estas se reversa en un incobrable,
// se corrompe la estructura del castigo (resetea la fila, borra boletas, y si está
// `validated` hasta devuelve capital). Ver crédito 23 / pago 121102 (system_reset,
// validated, abono 6,272.54 → reversarlo duplicaría el capital).
const SYSTEM_REGISTER_BY_PREFIXES = ["sistema", "sifco"];
const SYSTEM_REGISTER_BY_EXACT = ["system_reset"];

/**
 * En un crédito INCOBRABLE solo se permite reversar PAGOS DE RECUPERACIÓN reales:
 * un pago en `pending`/`validated` registrado por un usuario (no por el sistema).
 * Excluye filas estructurales (reset/castigo/SIFCO, abonos directos a capital).
 */
export function isReversibleIncobrablePayment({
  validationStatus,
  registerBy,
}: {
  validationStatus?: string | null;
  registerBy?: string | null;
}): boolean {
  const isRecoveryStatus =
    validationStatus === "pending" || validationStatus === "validated";
  if (!isRecoveryStatus) return false;

  const rb = (registerBy ?? "").trim().toLowerCase();
  if (SYSTEM_REGISTER_BY_EXACT.includes(rb)) return false;
  if (SYSTEM_REGISTER_BY_PREFIXES.some((prefix) => rb.startsWith(prefix))) {
    return false;
  }
  return true;
}

export function shouldRemoveSameInstallmentPaymentOnReverse(
  payment: SameInstallmentPayment,
) {
  return (
    toBig(payment.monto_aplicado).eq(0) &&
    toBig(payment.monto_boleta).eq(0) &&
    payment.validationStatus === "no_required" &&
    payment.pagado === false &&
    payment.paymentFalse !== true
  );
}

export function shouldInstallmentRemainPaidAfterReversal({
  cuota,
  remainingPayments,
}: {
  cuota?: string | number | null;
  remainingPayments: RemainingPayment[];
}) {
  const cuotaAmount = toBig(cuota);
  if (cuotaAmount.lte(0)) return false;

  const totalValidated = remainingPayments.reduce((total, payment) => {
    if (payment.validationStatus !== "validated" || payment.paymentFalse === true) {
      return total;
    }

    return total.plus(toBig(payment.monto_aplicado));
  }, new Big(0));

  return totalValidated.gte(cuotaAmount);
}

export function getRemainingPaymentPaidStatusAfterReversal(
  installmentRemainsPaid: boolean,
) {
  return installmentRemainsPaid;
}

export type RestantesRestaurados = {
  capital: Big | string | number;
  interes: Big | string | number;
  iva: Big | string | number;
  seguro: Big | string | number;
  gps: Big | string | number;
  membresias: Big | string | number;
};

export type ReplicaRestantesCuota = {
  cuotaId: number;
  creditoId: number;
  payload: {
    capital_restante: string;
    interes_restante: string;
    iva_12_restante: string;
    seguro_restante: string;
    gps_restante: string;
    membresias: string;
  };
};

/**
 * El saldo de una cuota vive REPLICADO en todas sus filas vivas.
 *
 * `insertPayment` estampa los `nuevo_*_restante` sobre TODAS las filas de la
 * cuota (`WHERE cuota_id = X AND credito_id = Y AND paymentFalse = false`), así
 * que cualquiera de ellas responde "cuánto le falta a esta cuota". La reversa
 * calculaba bien los restantes a devolver pero los escribía SÓLO en la fila
 * revertida: las hermanas quedaban con el saldo POSTERIOR al pago revertido y la
 * cuota "se veía" con menos deuda de la real.
 *
 * Y no alcanza con arreglar la semilla `no_required`: `registerPayment` elige
 * como saldo vigente la fila de `pago_id` más alto que esté viva y tenga
 * restante —normalmente una `validated`, que `recalcularPagosCredito` se niega a
 * tocar—, así que hay que dejar el saldo parejo en TODAS.
 *
 * Consecuencia medida en producción (crédito 9234): el siguiente pago distribuyó
 * contra el saldo subestimado, la cuota 1 de Q2,998.48 se cerró con Q1,000.00
 * cobrados y los Q1,998.48 sobrantes rebalsaron a la cuota 2.
 *
 * Devuelve `null` cuando el pago no cuelga de ninguna cuota (abono directo a
 * capital, fila suelta): ahí no hay cuota cuyo saldo replicar y un UPDATE sin
 * `cuota_id` barrería filas ajenas.
 *
 * También devuelve `null` cuando la fila revertida no le aportó nada a la
 * cuota (`aplicadoALaCuota` en cero): son los pagos de SOLO MORA / SOLO OTROS
 * / SOLO CONVENIO que crea `insertarPago` (registerPayment.ts). Esa función
 * los inserta con los seis `*_restante` en "0" literal y los engancha a la
 * primera cuota PENDIENTE vía `getSpecialPaymentCuotaId` — no a la cuota que
 * ellos "pagaron" (no pagaron ninguna, son mora/otros/convenio puros). Sin
 * esta guarda, revertir uno de estos pagos calcula
 * `nuevo*Restante = restante(0) + abono(0) = 0` para los seis y la réplica
 * estampa CERO en todas las filas vivas de esa cuota abierta, borrándole el
 * saldo real: la cuota queda incobrable y el pago siguiente la cierra corta,
 * el mismo defecto que este helper vino a arreglar, invertido.
 *
 * Y devuelve `null` cuando la fila que se revierte YA ESTÁ ANULADA
 * (`filaAnulada`, o sea `paymentFalse = true`). `falsePayment`
 * (controllers/payments.ts) anula haciendo sólo
 * `set({ pagado: false, paymentFalse: true })`: CONSERVA los `abono_*` y los
 * `*_restante` de la fila, así que la guarda de `aplicadoALaCuota === 0` no la
 * atrapa. Pero una fila anulada está FUERA de la contabilidad de la cuota
 * —`insertPayment` estampa el saldo replicado con `paymentFalse = false`
 * (registerPayment.ts), y el saldo que hoy llevan las hermanas vivas ya no
 * cuenta esa plata—, así que devolverle sus abonos al saldo replicado es doble
 * conteo: estampa en las hermanas VIVAS un saldo que incluye plata que ya no
 * existe. Contraejemplo: cuota de Q1,000; el pago A cobra 400 → se anula → el
 * pago B cobra 600 y salda la cuota; reversar A dejaría el saldo en Q1,000
 * cuando el cliente no debe nada, y el próximo pago le re-cobra Q600.
 *
 * Ojo: esto NO rechaza la reversa de una fila anulada — hoy es la única vía que
 * limpia la fila zombi con sus boletas e inversionistas. Sólo se salta la
 * réplica del saldo, que es lo que corrompería a las hermanas.
 */
export function buildInstallmentRemainderReplication({
  cuotaId,
  creditoId,
  restantes,
  aplicadoALaCuota,
  filaAnulada,
}: {
  cuotaId?: number | null;
  creditoId?: number | null;
  restantes: RestantesRestaurados;
  aplicadoALaCuota: string | number | Big;
  /** `pagos_credito.paymentFalse` de la fila que se está revirtiendo. */
  filaAnulada: boolean;
}): ReplicaRestantesCuota | null {
  if (cuotaId === null || cuotaId === undefined) return null;
  if (creditoId === null || creditoId === undefined) return null;
  if (filaAnulada) return null;
  if (new Big(aplicadoALaCuota ?? 0).eq(0)) return null;

  return {
    cuotaId,
    creditoId,
    payload: {
      capital_restante: toBig(String(restantes.capital)).toString(),
      interes_restante: toBig(String(restantes.interes)).toString(),
      iva_12_restante: toBig(String(restantes.iva)).toString(),
      seguro_restante: toBig(String(restantes.seguro)).toString(),
      gps_restante: toBig(String(restantes.gps)).toString(),
      membresias: toBig(String(restantes.membresias)).toString(),
    },
  };
}
