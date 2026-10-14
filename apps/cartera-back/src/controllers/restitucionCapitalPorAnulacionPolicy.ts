import Big from "big.js";
import { recomputeCreditAfterCapital } from "./registerPaymentPolicy";
import { isCreditStatusReversible, isReversibleIncobrablePayment } from "./reversePaymentPolicy";

/**
 * Anular un pago que YA bajó capital (validated con abono_capital > 0) tiene
 * que devolverle ese capital al crédito y a sus inversionistas, en la misma transacción que la
 * anulación. Esto es la regla pura; lee y escribe `restituirCapitalPorAnulacion.ts`.
 *
 * Cada código es un 409: la anulación no se hace y contabilidad lo resuelve a mano.
 *
 * Conocido y aceptado: si la validación topó el capital en 0 (recomputeCreditAfterCapital no deja
 * negativos), reponer `0 + abono` repone de más por (abono − capital previo), igual que la reversa.
 */
export type CodigoAnulacionCapital =
  | "CREDITO_NO_REVERSIBLE" // (a) crédito fuera de REVERSIBLE_CREDIT_STATUSES (p. ej. CANCELADO)
  | "FILA_ESTRUCTURAL_INCOBRABLE" // (b) INCOBRABLE y la fila no es una recuperación real
  | "PCI_LIQUIDADO" // (c) el reparto del pago ya se liquidó (o está por liquidarse)
  // El abono directo (capital_validated) además re-siembra cuotas/pendientes con el capital nuevo
  // y la reversa refresca la proyección; anularlo exige rehacer eso (pendiente). Por ahora, 409.
  | "ABONO_DIRECTO_NO_SOPORTADO"
  | "INVERSIONISTA_YA_NO_ESTA" // (e) PCI con capital de un inversionista que salió del crédito
  | "REPARTO_INCONSISTENTE" // (f) Σ PCI.abono_capital no cuadra con el abono del pago
  | "CUOTA_CERRADA_SIN_REPARTO"; // cuota cerrada sin PCI: no se sabe si se rebajó a los inversionistas

type Num = string | number | null | undefined;

const ESTADOS_QUE_MOVIERON_CAPITAL = ["validated", "capital_validated"];

export const mueveCapital = (validationStatus: string | null | undefined, abono_capital: Num) =>
  ESTADOS_QUE_MOVIERON_CAPITAL.includes(validationStatus ?? "") && new Big(abono_capital ?? 0).gt(0);

/** (a) y (b): se pueden decidir con el crédito y la fila candados, ANTES de marcar la fila. */
export function precheckAnulacionConCapital({
  validationStatus,
  abono_capital,
  registerBy,
  statusCredit,
}: {
  validationStatus?: string | null;
  abono_capital?: Num;
  registerBy?: string | null;
  statusCredit?: string | null;
}): CodigoAnulacionCapital | null {
  if (!mueveCapital(validationStatus, abono_capital)) return null;
  if (validationStatus === "capital_validated") return "ABONO_DIRECTO_NO_SOPORTADO";
  if (!isCreditStatusReversible(statusCredit)) return "CREDITO_NO_REVERSIBLE";
  if (statusCredit === "INCOBRABLE" && !isReversibleIncobrablePayment({ validationStatus, registerBy })) {
    return "FILA_ESTRUCTURAL_INCOBRABLE";
  }
  return null;
}

/**
 * La fórmula de `processAndReplaceCreditInvestors` (investor.ts): cuota sobre el monto aportado,
 * repartida entre inversionista y Cash-In, IVA 12 % de cada parte. Monto aportado a 8 decimales.
 */
export function recalcularMontosInversionista({
  montoAportado,
  porcentajeInversion,
  porcentajeCashIn,
  porcentajeInteres,
}: {
  montoAportado: Big | string | number;
  porcentajeInversion: Num | Big;
  porcentajeCashIn: Num | Big;
  porcentajeInteres: Num | Big;
}) {
  const monto = new Big(montoAportado);
  const cuota = monto.times(porcentajeInteres ?? 0).div(100).round(2);
  const montoInversionista = cuota.times(porcentajeInversion ?? 0).div(100).round(2);
  const montoCashIn = cuota.times(porcentajeCashIn ?? 0).div(100).round(2);
  const ivaInversionista = montoInversionista.gt(0) ? montoInversionista.times(0.12).round(2) : new Big(0);
  const ivaCashIn = montoCashIn.gt(0) ? montoCashIn.times(0.12).round(2) : new Big(0);
  return {
    monto_aportado: monto.toFixed(8),
    monto_inversionista: montoInversionista.toFixed(2),
    monto_cash_in: montoCashIn.toFixed(2),
    iva_inversionista: ivaInversionista.toFixed(2),
    iva_cash_in: ivaCashIn.toFixed(2),
  };
}

export type PlanRestitucionCapital =
  | { tipo: "SIN_CAPITAL" }
  | { tipo: "RECHAZAR"; codigo: CodigoAnulacionCapital }
  | {
      tipo: "REPONER";
      credito: { capital: string; cuotaInteres: string; iva: string; deudaTotal: string };
      inversionistas: Array<{ id: number; inversionista_id: number } & ReturnType<typeof recalcularMontosInversionista>>;
      borrarPci: true;
    };

export function planRestitucionCapital({
  pago,
  credito,
  filasPci,
  roster,
  cuotaCerrada,
}: {
  pago: { validationStatus?: string | null; abono_capital?: Num; registerBy?: string | null };
  credito: {
    capital: Num;
    statusCredit?: string | null;
    porcentaje_interes: Num;
    seguro_10_cuotas?: Num;
    gps?: Num;
    membresias_pago?: Num;
  };
  filasPci: Array<{ inversionista_id: number; abono_capital: Num; estado_liquidacion?: string | null; liquidacion_id?: number | null }>;
  roster: Array<{
    id: number;
    inversionista_id: number;
    monto_aportado: Num;
    porcentaje_participacion_inversionista: Num;
    porcentaje_cash_in: Num;
  }>;
  /** `cuotas_credito.pagado` de la cuota del pago, leído ANTES de reabrirla. */
  cuotaCerrada: boolean;
}): PlanRestitucionCapital {
  if (!mueveCapital(pago.validationStatus, pago.abono_capital)) return { tipo: "SIN_CAPITAL" };
  const previo = precheckAnulacionConCapital({ ...pago, statusCredit: credito.statusCredit });
  if (previo) return { tipo: "RECHAZAR", codigo: previo };
  // POR_LIQUIDAR también: la plata ya está comprometida con el inversionista.
  if (filasPci.some((f) => (f.estado_liquidacion ?? "NO_LIQUIDADO") !== "NO_LIQUIDADO" || f.liquidacion_id != null)) {
    return { tipo: "RECHAZAR", codigo: "PCI_LIQUIDADO" };
  }
  // RAMA B reparte TODOS los validated de la cuota al cerrarla: cerrada y sin PCI es legado.
  if (filasPci.length === 0 && cuotaCerrada) return { tipo: "RECHAZAR", codigo: "CUOTA_CERRADA_SIN_REPARTO" };

  // Lo que cada inversionista recupera: su PCI.abono_capital (sumado por si hubiera más de una fila).
  const abono = new Big(pago.abono_capital ?? 0);
  const porInversionista = new Map<number, Big>();
  for (const f of filasPci) {
    const monto = new Big(f.abono_capital ?? 0);
    if (monto.lte(0)) continue;
    if (!roster.some((r) => r.inversionista_id === f.inversionista_id)) {
      return { tipo: "RECHAZAR", codigo: "INVERSIONISTA_YA_NO_ESTA" };
    }
    porInversionista.set(f.inversionista_id, (porInversionista.get(f.inversionista_id) ?? new Big(0)).plus(monto));
  }

  // Las PCI van a 2 decimales y la validación restó con precisión completa: el residuo de
  // redondeo (hasta un centavo por inversionista con capital) va al de mayor abono, así Δ Σ monto_aportado == Δ capital.
  // Sin PCI (la cuota nunca cerró: RAMA A no reparte) solo se repone el capital.
  if (filasPci.length > 0) {
    const repartido = [...porInversionista.values()].reduce((s, m) => s.plus(m), new Big(0));
    const residuo = abono.minus(repartido);
    const [mayor] = [...porInversionista.entries()].sort((a, b) => b[1].cmp(a[1]) || a[0] - b[0]);
    // Sin PCI con abono, o con un residuo negativo que dejaría negativo al mayor, no hay a quién restituir.
    if (!mayor || residuo.abs().gt(new Big(0.01).times(porInversionista.size)) || mayor[1].plus(residuo).lt(0)) {
      return { tipo: "RECHAZAR", codigo: "REPARTO_INCONSISTENTE" };
    }
    porInversionista.set(mayor[0], mayor[1].plus(residuo));
  }

  const recomputado = recomputeCreditAfterCapital({
    statusCredit: credito.statusCredit,
    newCapital: new Big(credito.capital ?? 0).plus(abono),
    porcentajeInteres: credito.porcentaje_interes,
    seguro: credito.seguro_10_cuotas,
    gps: credito.gps,
    membresias: credito.membresias_pago,
  });

  const inversionistas = roster
    .filter((r) => porInversionista.has(r.inversionista_id))
    .sort((a, b) => a.inversionista_id - b.inversionista_id)
    .map((r) => ({
      id: r.id,
      inversionista_id: r.inversionista_id,
      ...recalcularMontosInversionista({
        montoAportado: new Big(r.monto_aportado ?? 0).plus(porInversionista.get(r.inversionista_id)!),
        porcentajeInversion: r.porcentaje_participacion_inversionista,
        porcentajeCashIn: r.porcentaje_cash_in,
        porcentajeInteres: credito.porcentaje_interes,
      }),
    }));

  return {
    tipo: "REPONER",
    credito: {
      capital: recomputado.capital.toFixed(2),
      cuotaInteres: recomputado.cuotaInteres.toFixed(2),
      iva: recomputado.iva.toFixed(2),
      deudaTotal: recomputado.deudaTotal.toFixed(2),
    },
    inversionistas,
    borrarPci: true,
  };
}
