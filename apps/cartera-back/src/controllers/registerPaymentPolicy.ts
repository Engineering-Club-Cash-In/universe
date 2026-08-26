import Big from "big.js";
import z from "zod";

type BigInput = number | string | Big;

// Schema del body de /newPayment. Vive en este módulo puro (sin conexión a
// BD) para que los tests puedan importarlo sin levantar la base.
export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0),
  fecha_pago: z.string(),
  llamada: z.string().optional(),
  renuevo_o_nuevo: z.string().optional(),
  otros: z.number().min(0).optional(),
  // Mismo tope que valida el form del front (hooks/registerPayment.ts).
  observaciones: z.string().max(500).optional(),
  abono_directo_capital: z.number().min(0).optional(),
  cuotaApagar: z.number().int(),
  url_boletas: z.array(z.string()),
  banco_id: z.number().int().positive().optional(),
  numeroAutorizacion: z.string().optional(),
  registerBy: z.string().min(1),
  fecha_boleta: z.string(),
  origen_pago: z.enum(["transferencia", "cheque", "boleta"]).optional().default("transferencia"),
});

export const CREDIT_PENDING_CANCELLATION_ERROR = {
  code: "CREDIT_PENDING_CANCELLATION",
  message:
    "No se puede registrar el pago porque el crédito está pendiente de cancelación.",
} as const;

export const getCreditPaymentBlock = (statusCredit: string | null | undefined) =>
  statusCredit === "PENDIENTE_CANCELACION"
    ? CREDIT_PENDING_CANCELLATION_ERROR
    : null;

export const getCuotaIdForPaymentInsert = (
  cuotaId: number | null | undefined
) => cuotaId ?? null;

export const getRequestedInstallmentFloor = (_requestedInstallment: number) => 1;

export const shouldMarkInstallmentPaymentPaid = ({
  allRemainingZero,
  hasExistingInstallmentPayment,
  installmentAmountApplied,
}: {
  allRemainingZero: boolean;
  hasExistingInstallmentPayment: boolean;
  installmentAmountApplied: number | string;
}) =>
  allRemainingZero &&
  hasExistingInstallmentPayment &&
  Number(installmentAmountApplied) > 0;

export const shouldRejectZeroAppliedNormalValidation = ({
  validationStatus,
  nextValidationStatus,
  montoAplicado,
  mora = 0,
  otros = 0,
  pagoConvenio = 0,
}: {
  validationStatus?: string | null;
  nextValidationStatus?: string | null;
  montoAplicado?: BigInput | null;
  mora?: BigInput | null;
  otros?: string | number | null;
  pagoConvenio?: BigInput | null;
}) => {
  if (nextValidationStatus !== "validated") return false;
  if (["capital", "capital_validated", "reset"].includes(validationStatus ?? "")) {
    return false;
  }

  const numericText = (v: string | number | null | undefined) => {
    if (v == null) return "0";
    const s = String(v).trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? s : "0";
  };

  return (
    new Big(montoAplicado ?? 0).eq(0) &&
    new Big(mora ?? 0).eq(0) &&
    new Big(numericText(otros)).eq(0) &&
    new Big(pagoConvenio ?? 0).eq(0)
  );
};

export const getApplyPaymentHttpStatus = (result: { success?: boolean }) =>
  result.success === false ? 400 : 200;

export const shouldApplyStaleZeroRestanteAdjustment = ({
  hasExistingPayment,
  isFirstProcessedInstallment,
  isExactSingleInstallmentPayment,
  hasValidatedPayments,
  hasLastPartialPaymentWithRemaining,
  allRemainingZero,
  missingAgainstInstallment,
  availableRemaining,
}: {
  hasExistingPayment: boolean;
  isFirstProcessedInstallment: boolean;
  isExactSingleInstallmentPayment: boolean;
  hasValidatedPayments: boolean;
  hasLastPartialPaymentWithRemaining: boolean;
  allRemainingZero: boolean;
  missingAgainstInstallment: BigInput;
  availableRemaining: BigInput;
}) =>
  hasExistingPayment &&
  isFirstProcessedInstallment &&
  isExactSingleInstallmentPayment &&
  !hasValidatedPayments &&
  !hasLastPartialPaymentWithRemaining &&
  allRemainingZero &&
  new Big(missingAgainstInstallment).gt(0) &&
  new Big(availableRemaining).gte(missingAgainstInstallment);

/**
 * Cuota a la que se engancha un pago especial (sólo mora / sólo otros).
 *
 * `fallbackCuotaId` cubre el caso sin pendientes utilizables: un INCOBRABLE con
 * todas sus cuotas abiertas ya cubiertas queda con la lista vacía y, sin este
 * fallback, devolvía 0 — que `insertarPago` interpreta como "sin filtro" y
 * termina heredando el `cuota_id` del pago más viejo del crédito. Mejor apuntar
 * explícitamente a la cuota cubierta.
 */
export const getSpecialPaymentCuotaId = ({
  requestedInstallment,
  pendingInstallments,
  fallbackCuotaId,
}: {
  requestedInstallment: number;
  pendingInstallments: { numeroCuota: number; cuotaId: number }[];
  fallbackCuotaId?: number | null;
}) =>
  pendingInstallments.find(
    (installment) => installment.numeroCuota === requestedInstallment
  )?.cuotaId ??
  pendingInstallments[0]?.cuotaId ??
  fallbackCuotaId ??
  0;

export const getSpecialPaymentInstallmentFields = () => ({
  montoAplicado: 0,
  pagado: true,
});

// Umbral para considerar un monto "cero". Las columnas monetarias son
// numeric(2), así que el mínimo pago real representable es Q0.01: una fila se
// considera vacía solo si cada monto es ESTRICTAMENTE menor a un centavo (i.e.
// 0.00). Un Q0.01 es un pago real y NO debe tratarse como sobrescribible (con
// `lte` el cierre lo machacaría, reintroduciendo la pérdida para parciales de
// un centavo).
export const DESTINO_SOBRESCRIBIBLE_TOLERANCE = 0.01;

/** Subconjunto de una fila de pago necesario para decidir si es sobrescribible. */
export type DestinoSobrescribibleRow = {
  validationStatus?: string | null;
  monto_aplicado?: BigInput | null;
  abono_capital?: BigInput | null;
  abono_interes?: BigInput | null;
  abono_iva_12?: BigInput | null;
  abono_seguro?: BigInput | null;
  abono_gps?: BigInput | null;
  membresias_pago?: BigInput | null;
  abono_interes_ci?: BigInput | null;
  abono_iva_ci?: BigInput | null;
  // Buckets de plata que un pago de solo mora/otros/convenio (insertarPago /
  // getSpecialPaymentInstallmentFields) lleva con `monto_aplicado` y `abono_*`
  // en 0 — hay que contarlos o el cierre los machacaría. `otros` es TEXT.
  mora?: BigInput | null;
  pagoConvenio?: BigInput | null;
  otros?: string | number | null;
};

/**
 * ¿La fila de pago elegida como `existingPago` se puede SOBRESCRIBIR (UPDATE) al
 * cerrar la cuota, sin destruir plata real?
 *
 * El cierre de una cuota hace `UPDATE pagos_credito SET <pagoData> WHERE
 * pago_id = existingPago`. Eso es seguro SOLO si la fila destino es desechable:
 *
 *  - El placeholder `no_required` importado de SIFCO (su único propósito es
 *    portar los `*_restante`; no representa plata aplicada), o
 *  - Una fila "vacía": SIN plata en NINGÚN bucket — `monto_aplicado`, todos los
 *    `abono_*`, y también `mora`, `pagoConvenio` y `otros` ≈ 0. (Un pago de solo
 *    mora/otros/convenio lleva `monto_aplicado`/`abono_*` en 0 pero plata en
 *    esos otros campos; si no se contaran, el cierre lo machacaría.)
 *
 * Cuando el placeholder `no_required` ya fue consumido por un parcial previo,
 * `existingPago` cae al fallback `allExistingPagos[0]` = la fila REAL más vieja
 * (con `abono_interes` validado, posiblemente ya facturado). Sobrescribirla
 * borraría ese pago. En ese caso esta función devuelve `false` y el caller debe
 * INSERTAR una fila de cierre nueva en vez de hacer UPDATE.
 */
export const esDestinoSobrescribible = (
  pago: DestinoSobrescribibleRow
): boolean => {
  if (pago.validationStatus === "no_required") return true;

  const tol = new Big(DESTINO_SOBRESCRIBIBLE_TOLERANCE);
  // Estricto (`lt`, no `lte`): un Q0.01 exacto es un pago real, no "vacío".
  const casiCero = (v: BigInput | null | undefined) =>
    new Big(v ?? 0).abs().lt(tol);
  // `otros` es TEXT y puede venir null/''/no-numérico → parsear con guard.
  const otrosCasiCero = (v: string | number | null | undefined) => {
    if (v == null) return true;
    const s = String(v).trim();
    if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return true;
    return new Big(s).abs().lt(tol);
  };

  return (
    casiCero(pago.monto_aplicado) &&
    casiCero(pago.abono_capital) &&
    casiCero(pago.abono_interes) &&
    casiCero(pago.abono_iva_12) &&
    casiCero(pago.abono_seguro) &&
    casiCero(pago.abono_gps) &&
    casiCero(pago.membresias_pago) &&
    casiCero(pago.abono_interes_ci) &&
    casiCero(pago.abono_iva_ci) &&
    // Plata real fuera de los abono_* de cuota: mora, convenio y otros.
    casiCero(pago.mora) &&
    casiCero(pago.pagoConvenio) &&
    otrosCasiCero(pago.otros)
  );
};

export type SaldoCuotaInput = {
  /** Monto total de la cuota (credito.cuota). */
  montoCuota: BigInput;
  /**
   * Σ de los rubros de cuota aplicados por los pagos hermanos vivos
   * (validated/pending): capital + interés + IVA + seguro + GPS + membresías.
   * Excluye mora/otros y abonos directos a capital (no son parte de la cuota).
   * Ver `sumarAplicadoACuota`.
   */
  aplicadoPrevioCuota: BigInput;
  // Saldos que indica la fila de pago vigente (pueden estar desincronizados).
  filaInteresRestante: BigInput;
  filaIvaRestante: BigInput;
  filaSeguroRestante: BigInput;
  filaGpsRestante: BigInput;
  filaMembresiasRestante: BigInput;
  filaCapitalRestante: BigInput;
  // Objetivo por cuota de cada rubro plano (del crédito).
  objetivoSeguro: BigInput;
  objetivoGps: BigInput;
  objetivoMembresias: BigInput;
  // Ya abonado por los pagos hermanos vivos en cada rubro plano. Para
  // seguro/GPS/membresías son TODOS los hermanos (se netea contra el objetivo
  // plano del crédito).
  hermanosSeguro: BigInput;
  hermanosGps: BigInput;
  hermanosMembresias: BigInput;
  // Interés/IVA ya abonado por hermanos DISTINTOS a la fila vigente. El interés
  // por cuota no tiene un objetivo plano confiable (el real difiere del nominal
  // `credito.cuota_interes`), así que no se puede netear contra el crédito sin
  // sub-cobrar en cuotas frescas. En su lugar se netea la fila menos lo que
  // aplicaron los OTROS hermanos: la fila ya refleja su propia aplicación, y lo
  // de los demás hermanos es lo que la fila stale podría re-aplicar.
  hermanosInteres: BigInput;
  hermanosIva: BigInput;
};

/** Fila de pago hermano con sus rubros de cuota (los `abono_*`). */
export type RubrosCuotaRow = {
  abono_capital?: BigInput | null;
  abono_interes?: BigInput | null;
  abono_iva_12?: BigInput | null;
  abono_seguro?: BigInput | null;
  abono_gps?: BigInput | null;
  membresias_pago?: BigInput | null;
};

export type PagoCoberturaCuota = RubrosCuotaRow & {
  // number | null: las filas que vienen de un leftJoin traen null cuando la
  // cuota no tiene pago; solo se usa en comparaciones de igualdad.
  pago_id?: number | null;
  validationStatus?: string | null;
  paymentFalse?: boolean | null;
  mora?: BigInput | null;
  otros?: string | number | null;
  pagoConvenio?: BigInput | null;
};

/**
 * Σ de lo que los pagos hermanos aplicaron a la CUOTA contractual
 * (`credito.cuota`): capital + interés + IVA + seguro + GPS + membresías.
 *
 * A propósito NO usa `monto_aplicado` ni suma `mora`/`otros`. Esos buckets no
 * son parte de la cuota:
 *  - Las filas de sólo mora/otros traen TODOS los `abono_*` en 0, así que
 *    aportan 0 (su `monto_aplicado` legacy = mora+otros, que no es cuota).
 *  - Los abonos directos a capital viven en `validationStatus = "capital"` y
 *    ni siquiera entran al set de hermanos vivos.
 *
 * Para una fila de cuota normal `monto_aplicado` == esta suma, así que en datos
 * limpios es equivalente; sólo deja de inflar el faltante con mora/otros, que
 * antes colapsaba `saldoRealCuota` a 0 y disparaba un rechazo falso de
 * "sobre-aplicación".
 */
export const sumarAplicadoACuota = (rows: RubrosCuotaRow[]): Big =>
  rows.reduce(
    (acc, r) =>
      acc
        .plus(new Big(r.abono_capital ?? 0))
        .plus(new Big(r.abono_interes ?? 0))
        .plus(new Big(r.abono_iva_12 ?? 0))
        .plus(new Big(r.abono_seguro ?? 0))
        .plus(new Big(r.abono_gps ?? 0))
        .plus(new Big(r.membresias_pago ?? 0)),
    new Big(0)
  );

export const calcularCoberturaCuota = ({
  montoCuota,
  pagos,
  pagoIdEnValidacion,
  incluirPendientes = false,
}: {
  montoCuota: BigInput;
  pagos: PagoCoberturaCuota[];
  pagoIdEnValidacion?: number;
  incluirPendientes?: boolean;
}) => {
  const monto = new Big(montoCuota);
  const aplicados = pagos.filter(
    (pago) =>
      pago.paymentFalse === false &&
      (pago.validationStatus === "validated" ||
        (pago.validationStatus === "pending" &&
          (incluirPendientes ||
            (pagoIdEnValidacion !== undefined &&
              pago.pago_id === pagoIdEnValidacion))))
  );
  const totalAplicado = sumarAplicadoACuota(aplicados);
  const saldoPendiente = monto.minus(totalAplicado);
  const cuotaCompleta =
    monto.gt(0) && totalAplicado.gte(monto.minus(0.01));

  return {
    totalAplicado,
    saldoPendiente: saldoPendiente.gt(0) ? saldoPendiente : new Big(0),
    cuotaCompleta,
    tieneAbonoParcial:
      !cuotaCompleta && totalAplicado.gt(0) && totalAplicado.lt(monto),
  };
};

export type FilaCuotaVencida = PagoCoberturaCuota & {
  cuota_id: number | null;
  numero_cuota: number | null;
  // Para detectar recibos SALDADOS de cuotas recortadas (ver esReciboSaldado).
  // pago_mora/pago_otros son los alias con que la query del buscador devuelve
  // mora e importes "otros"; monto_aplicado respalda la vía stale-zero.
  monto_aplicado?: BigInput | null;
  pago_mora?: BigInput | null;
  pago_otros?: string | number | null;
  capital_restante?: BigInput | null;
  interes_restante?: BigInput | null;
  iva_12_restante?: BigInput | null;
  seguro_restante?: BigInput | null;
  gps_restante?: BigInput | null;
  membresias_restante?: BigInput | null;
};

/**
 * ¿Este recibo quedó SALDADO? — plata aplicada y todos los restantes en ≤0.01.
 *
 * Cubre las cuotas RECORTADAS: tras un abono grande el recálculo topa el
 * capital del último recibo (y los de cola quedan solo con seguro/GPS), así
 * que su total real es MENOR a `credito.cuota` y la suma de rubros nunca las
 * daría por cubiertas. Mismo criterio con el que aplicarPagoNormalEnTx cierra
 * esas cuotas (registerPayment.ts, "Recibos MENORES a la cuota mensual").
 */
const esReciboSaldado = (row: FilaCuotaVencida): boolean => {
  if (row.paymentFalse !== false) return false;
  // Plata aplicada A LA CUOTA: primero los rubros (abono_*). En filas legacy
  // de solo mora/otros el monto_aplicado trae mora+otros con los abono_* en
  // 0 — esas no saldan nada. PERO la vía stale-zero (registerPayment,
  // shouldApplyStaleZeroRestanteAdjustment) consume el monto exacto subiendo
  // monto_aplicado SIN repartir rubros (los restantes origen ya estaban en
  // 0): ahí la evidencia de plata de cuota es monto_aplicado − mora − otros.
  if (!sumarAplicadoACuota([row]).gt(0)) {
    const numericText = (v: string | number | null | undefined) => {
      if (v == null) return "0";
      const s = String(v).trim();
      return /^-?\d+(\.\d+)?$/.test(s) ? s : "0";
    };
    const plataSinMoraOtros = new Big(row.monto_aplicado ?? 0)
      .minus(new Big(row.pago_mora ?? 0))
      .minus(new Big(numericText(row.pago_otros)));
    if (!plataSinMoraOtros.gt(0)) return false;
  }
  // TODOS los restantes deben venir informados para afirmar el saldado: un
  // NULL no es un cero. Con .some, una fila legacy con interes_restante=0
  // pero capital_restante NULL pasaría y el ?? 0 escondería deuda viva
  // (review Codex). Sin el atajo, la cuota se decide por la suma de rubros.
  const restantesInformados = [
    row.capital_restante,
    row.interes_restante,
    row.iva_12_restante,
    row.seguro_restante,
    row.gps_restante,
    row.membresias_restante,
  ].every((v) => v !== null && v !== undefined);
  if (!restantesInformados) return false;
  const restantes = new Big(row.capital_restante ?? 0)
    .plus(new Big(row.interes_restante ?? 0))
    .plus(new Big(row.iva_12_restante ?? 0))
    .plus(new Big(row.seguro_restante ?? 0))
    .plus(new Big(row.gps_restante ?? 0))
    .plus(new Big(row.membresias_restante ?? 0));
  return restantes.lte(0.01);
};

/**
 * Cobertura de una cuota (grupo de filas de la misma numero_cuota): por suma
 * de rubros contra el valor contractual, O por un recibo saldado (cuota
 * recortada). `incluirPendientes` controla si los pagos pending cuentan en
 * ambas vías.
 */
const cuotaCubiertaPorGrupo = (
  grupo: FilaCuotaVencida[],
  montoCuota: BigInput,
  incluirPendientes: boolean
): boolean => {
  const { cuotaCompleta } = calcularCoberturaCuota({
    montoCuota,
    pagos: grupo,
    incluirPendientes,
  });
  if (cuotaCompleta) return true;

  // El atajo del recibo saldado es consciente del GRUPO (review Codex): en una
  // cuota partida, la fila de CIERRE queda con restantes 0 por diseño aunque
  // sus hermanos sigan vivos (cierre diferido, registerPayment.ts). Un cierre
  // validated no puede dar la cuota por firme mientras haya un hermano pending
  // con plata (la cuota sigue dependiendo de él → en validación), y si un
  // hermano con plata fue ANULADO, el atajo se descarta por completo: los
  // restantes 0 del cierre son residuo y la deuda del hermano volvió a existir
  // (la suma de rubros decide, y sin esa plata no cubre).
  const hayPlataAnulada = grupo.some(
    (row) => row.paymentFalse === true && sumarAplicadoACuota([row]).gt(0)
  );
  if (hayPlataAnulada) return false;

  const hayPendienteConPlata = grupo.some(
    (row) =>
      row.paymentFalse === false &&
      row.validationStatus === "pending" &&
      sumarAplicadoACuota([row]).gt(0)
  );

  return grupo.some(
    (row) =>
      esReciboSaldado(row) &&
      (row.validationStatus === "validated"
        ? incluirPendientes || !hayPendienteConPlata
        : incluirPendientes && row.validationStatus === "pending")
  );
};

/**
 * Filtro del contador de "cuotas atrasadas" del buscador de créditos
 * (getCreditoByNumero): de las filas de cuotas vencidas sin cerrar, deja solo
 * las de cuotas NO cubiertas por montos.
 *
 * Reemplaza al criterio viejo por flags (NOT EXISTS pago pending con
 * pagado=true), que mentía en los dos sentidos: una boleta pending marcada
 * pagado=true ocultaba la cuota sin verificar cuánto dinero traía, y una cuota
 * ya cobrada con flags desincronizados seguía contando como atrasada. La
 * verdad son los montos: Σ rubros de pagos vivos (validated + pending,
 * paymentFalse=false) vs el valor contractual de la cuota, con la tolerancia
 * de Q0.01 de calcularCoberturaCuota.
 *
 * Recibe las filas tal como salen del leftJoin (una por par cuota-pago) y
 * devuelve esas mismas filas (orden y multiplicidad intactos) para las cuotas
 * descubiertas — el shape que el front ya consume no cambia.
 */
// Agrupar por numero_cuota, NO por cuota_id: hay créditos con filas
// duplicadas de la misma cuota contractual (mismo numero_cuota, cuota_id
// distinto) y sus pagos quedan repartidos entre los duplicados. Mismo
// criterio de merge que getCoveredOpenInstallments.
const agruparPorNumeroCuota = <T extends FilaCuotaVencida>(
  rows: T[]
): Map<number | null, T[]> => {
  const porNumeroCuota = new Map<number | null, T[]>();
  for (const row of rows) {
    const grupo = porNumeroCuota.get(row.numero_cuota);
    if (grupo) {
      grupo.push(row);
    } else {
      porNumeroCuota.set(row.numero_cuota, [row]);
    }
  }
  return porNumeroCuota;
};

export const filtrarCuotasVencidasSinCobertura = <T extends FilaCuotaVencida>(
  rows: T[],
  montoCuota: BigInput
): T[] => {
  const cubiertas = new Set<number | null>();
  for (const [numeroCuota, grupo] of agruparPorNumeroCuota(rows)) {
    if (cuotaCubiertaPorGrupo(grupo, montoCuota, true)) {
      cubiertas.add(numeroCuota);
    }
  }

  return rows.filter((row) => !cubiertas.has(row.numero_cuota));
};

/**
 * Cuotas vencidas cuya cobertura DEPENDE de boletas aún sin validar: cubiertas
 * contando pendientes, pero que no se sostienen solo con lo validated.
 *
 * Es el complemento informativo de filtrarCuotasVencidasSinCobertura: esas
 * cuotas NO se muestran como atrasadas (el dinero ya está registrado), pero el
 * asesor debe saber que están esperando validación de contabilidad — mientras
 * tanto el cron de moras (que solo cree en lo validated) puede seguir
 * generándoles mora.
 */
export const filtrarCuotasEnValidacion = <T extends FilaCuotaVencida>(
  rows: T[],
  montoCuota: BigInput
): T[] => {
  const enValidacion = new Set<number | null>();
  for (const [numeroCuota, grupo] of agruparPorNumeroCuota(rows)) {
    if (!cuotaCubiertaPorGrupo(grupo, montoCuota, true)) continue; // atrasada
    if (cuotaCubiertaPorGrupo(grupo, montoCuota, false)) continue; // firme sin pendientes

    enValidacion.add(numeroCuota);
  }

  return rows.filter((row) => enValidacion.has(row.numero_cuota));
};

type CuotaAbiertaConPagos = {
  cuotaId: number;
  numeroCuota: number;
  pagos: PagoCoberturaCuota[];
};

/**
 * Cuotas ABIERTAS cuyos pagos vivos ya cubren el monto contractual, mergeadas
 * por `numero_cuota` (hay créditos con filas duplicadas de la misma cuota:
 * mismo numero_cuota, cuota_id distinto).
 */
const getCoveredOpenInstallments = ({
  montoCuota,
  cuotas,
  incluirPendientes = false,
}: {
  montoCuota: BigInput;
  cuotas: CuotaAbiertaConPagos[];
  incluirPendientes?: boolean;
}) => {
  const cuotasLogicas = new Map<number, CuotaAbiertaConPagos>();
  for (const cuota of cuotas) {
    const existente = cuotasLogicas.get(cuota.numeroCuota);
    cuotasLogicas.set(
      cuota.numeroCuota,
      existente
        ? { ...existente, pagos: [...existente.pagos, ...cuota.pagos] }
        : cuota
    );
  }

  return [...cuotasLogicas.values()].filter(
    (cuota) =>
      calcularCoberturaCuota({
        montoCuota,
        pagos: cuota.pagos,
        incluirPendientes,
      }).cuotaCompleta
  );
};

export const getCoveredOpenInstallment = ({
  montoCuota,
  cuotas,
}: {
  montoCuota: BigInput;
  cuotas: CuotaAbiertaConPagos[];
}) => {
  const [inconsistente] = getCoveredOpenInstallments({ montoCuota, cuotas });

  return inconsistente
    ? {
        cuotaId: inconsistente.cuotaId,
        numeroCuota: inconsistente.numeroCuota,
      }
    : null;
};

/**
 * ¿El pago va COMPLETO a abono directo a capital, sin efectivo para cuotas?
 *
 * Espeja la aritmética de `calcularMontoEfectivo` (boleta − otros − abono
 * directo; el saldo a favor NO entra, el cálculo real lo ignora). Si el efectivo
 * queda en 0 el loop de cuotas ni siquiera corre, así que un pago solo-capital
 * no depende de que existan cuotas abiertas con saldo: es la vía válida para
 * abonar a un INCOBRABLE que ya tiene todas sus cuotas cubiertas.
 *
 * Exige efectivo EXACTAMENTE 0, no <= 0: un efectivo negativo significa que se
 * pidió más capital del que trae la boleta (la sección 7 registra el monto
 * PEDIDO, no el recibido — una boleta de Q1,000 registraría Q5,000 de capital),
 * así que un request sobre-asignado no es solo-capital y el guard lo rechaza.
 */
export const esPagoSoloCapital = ({
  montoBoleta,
  otros,
  abonoDirectoCapital,
}: {
  montoBoleta: BigInput;
  otros?: BigInput | null;
  abonoDirectoCapital?: BigInput | null;
}): boolean => {
  const capital = new Big(abonoDirectoCapital ?? 0);
  if (capital.lte(0)) return false;

  const montoEfectivo = new Big(montoBoleta)
    .minus(new Big(otros ?? 0))
    .minus(capital);

  return montoEfectivo.eq(0);
};

/**
 * ¿El pago es SOLO el rubro `otros` (monto_boleta == otros), sin nada más?
 *
 * Exige capital pedido en 0: un request con `boleta == otros` que además trae
 * `abono_directo_capital` deja el efectivo en −capital (sobre-asignación — la
 * sección 7 registraría el monto PEDIDO encima de la fila de otros, y una
 * boleta de Q1,000 asignaría Q6,000). Ese request no es "sólo otros" y no debe
 * omitir el guard de todas-cubiertas. El `gt(0)` existe porque el schema admite
 * monto_boleta 0 y un {boleta: 0, otros: 0} tampoco clasifica.
 *
 * OJO: esto es la CLASIFICACIÓN del request (para el bypass del guard). La rama
 * runtime que inserta la fila especial sigue siendo `monto_boleta == otros` a
 * secas — para el predicado anti-pérdida lo que importa es qué se ESCRIBIÓ, no
 * cómo clasifica (ver `debeRechazarAbonoCapitalNoAplicado`).
 */
export const esPagoSoloOtros = ({
  montoBoleta,
  otros,
  abonoDirectoCapital,
}: {
  montoBoleta: BigInput;
  otros?: BigInput | null;
  abonoDirectoCapital?: BigInput | null;
}): boolean => {
  const boleta = new Big(montoBoleta);
  return (
    boleta.gt(0) &&
    boleta.eq(new Big(otros ?? 0)) &&
    new Big(abonoDirectoCapital ?? 0).eq(0)
  );
};

/**
 * ¿Este pago puede saltarse el guard de "todas las cuotas abiertas cubiertas"?
 *
 * Sólo lo omiten las vías que NO necesitan una cuota con saldo:
 *  - Solo-capital, pero **únicamente** si el crédito permite abonos a capital.
 *    La sección 7 exige `(estaAlDia || permite_abono_capital) && abono > 0`; en
 *    un INCOBRABLE `estaAlDia` es siempre false (no tiene cuota pagada vigente)
 *    y todos los insolutos traen `permite_abono_capital = false` por default de
 *    la columna, así que sin permiso el abono no se aplica y dejarlo pasar sólo
 *    cambiaría un 409 por una boleta perdida. El disyunto `estaAlDia` se ignora
 *    a propósito: no es computable en `obtenerInfoCompletaCredito`.
 *  - Sólo otros (`monto_boleta == otros` y SIN capital pedido — ver
 *    `esPagoSoloOtros`), que se registra con su propio insert especial y nunca
 *    toca el loop de cuotas.
 *
 * El pago de sólo mora queda FUERA a propósito: hoy es inalcanzable porque el
 * cron de moras excluye a los INCOBRABLES (ninguno tiene mora activa), así que
 * prefiero el 409 ruidoso a abrir una vía sin probar si eso llegara a cambiar.
 */
export const puedeOmitirGuardTodasCubiertas = ({
  esSoloCapital,
  permiteAbonoCapital,
  pagoSoloOtros,
}: {
  esSoloCapital: boolean;
  permiteAbonoCapital?: boolean | null;
  pagoSoloOtros: boolean;
}): boolean =>
  (esSoloCapital && permiteAbonoCapital === true) || pagoSoloOtros;

/**
 * ¿Hay que rechazar el pago porque traía abono a capital, no se aplicó y no se
 * escribió NADA?
 *
 * Es el camino en que insertPayment respondía `success: true` con cero filas en
 * `pagos_credito` (la sección 7 no corrió por falta de permiso y el loop de
 * cuotas tampoco, porque el monto efectivo era 0): la boleta se perdía en
 * silencio. Sólo es seguro rechazar si nada se insertó antes — de ahí que se
 * exija cero cuotas aplicadas, cero mora aplicada y que la rama especial de
 * `otros` no haya insertado ya su fila.
 *
 * `otrosEspecialAplicado` es la condición RUNTIME de esa rama (`monto_boleta ==
 * otros`, sin mirar el capital) — NO la clasificación `esPagoSoloOtros`: acá
 * importa qué se escribió, y la rama inserta aunque el request traiga capital
 * colado. Usar la clasificación aquí respondería 409 sobre estado ya escrito.
 *
 * `convenioAplicado`: en EN_CONVENIO el registro del convenio corre ANTES del
 * loop de cuotas, así que `processConvenioPayment` YA actualizó
 * `convenios_pago`. Responder 409 ahí mentiría sobre estado persistido y el
 * reintento de la boleta acreditaría el convenio DOS veces.
 */
export const debeRechazarAbonoCapitalNoAplicado = ({
  abonoCapital,
  cuotasCompletas,
  cuotasParciales,
  moraAplicada,
  otrosEspecialAplicado,
  convenioAplicado = 0,
}: {
  abonoCapital: BigInput;
  cuotasCompletas: number;
  cuotasParciales: number;
  moraAplicada: BigInput;
  otrosEspecialAplicado: boolean;
  convenioAplicado?: BigInput;
}): boolean =>
  new Big(abonoCapital ?? 0).gt(0) &&
  cuotasCompletas === 0 &&
  cuotasParciales === 0 &&
  new Big(moraAplicada ?? 0).lte(0) &&
  new Big(convenioAplicado ?? 0).lte(0) &&
  !otrosEspecialAplicado;

/**
 * Números de cuota abiertos que ya están cubiertos por pagos vivos.
 *
 * Sólo para INCOBRABLES: ahí la cuota NO se cierra al cubrir el monto
 * contractual, sino cuando el capital del crédito llega a 0 (ver
 * `shouldIncobrableInstallmentBePaid`, regla del PR #887), así que una cuota
 * "cubierta pero abierta" es el estado normal de un insoluto a medio pagar, no
 * una inconsistencia. El caller filtra esas cuotas de las pendientes para que
 * el pago nuevo caiga en la siguiente cuota CON saldo: si lo dejáramos entrar,
 * su saldo neto daría 0 en todos los rubros y se insertaría una fila pending
 * con `monto_aplicado = 0` (nunca validable) que además duplica la boleta.
 *
 * Cuenta los pending vivos (`incluirPendientes`) porque el loop de insertPayment
 * también los cuenta como hermanos al calcular el saldo de la cuota: el criterio
 * del skip tiene que ser el mismo o la fila en cero vuelve por esa vía. El gate
 * normal (`getCoveredOpenInstallment`) sigue mirando sólo `validated`.
 */
export const getCoveredInstallmentNumbers = ({
  montoCuota,
  cuotas,
}: {
  montoCuota: BigInput;
  cuotas: CuotaAbiertaConPagos[];
}): Set<number> =>
  new Set(
    getCoveredOpenInstallments({
      montoCuota,
      cuotas,
      incluirPendientes: true,
    }).map((cuota) => cuota.numeroCuota)
  );

export type ResumenAbonosCuota = {
  cuotaCerrada: boolean;
  totalAplicadoCuota: string;
  saldoPendiente: string;
  tieneAbonoParcial: boolean;
};

export const calcularResumenAbonosCuota = ({
  montoCuota,
  cuotaCerrada,
  pagos,
}: {
  montoCuota: BigInput;
  cuotaCerrada: boolean;
  pagos: PagoCoberturaCuota[];
}): ResumenAbonosCuota => {
  const cobertura = calcularCoberturaCuota({
    montoCuota,
    pagos,
    incluirPendientes: true,
  });

  return {
    cuotaCerrada,
    totalAplicadoCuota: cobertura.totalAplicado.toFixed(2),
    saldoPendiente: cobertura.saldoPendiente.toFixed(2),
    tieneAbonoParcial: !cuotaCerrada && cobertura.tieneAbonoParcial,
  };
};

export type SaldoCuotaNeto = {
  saldoRealCuota: Big;
  interesRestante: Big;
  ivaRestante: Big;
  seguroRestante: Big;
  gpsRestante: Big;
  membresiasRestante: Big;
  capitalRestante: Big;
};

/**
 * Saldo NETO de una cuota para distribuir un pago, robusto ante `*_restante`
 * desincronizados entre pagos hermanos.
 *
 * - Faltante real de la cuota = monto_cuota − Σ rubros de cuota de hermanos
 *   (capital+interés+IVA+seguro+GPS+membresías; ver `sumarAplicadoACuota`).
 *   NO se cuenta mora/otros ni abonos directos a capital: no son cuota.
 * - Rubros planos (seguro/GPS/membresías) = mín(saldo de la fila, objetivo −
 *   ya abonado por hermanos), nunca negativo. Así un rubro ya cubierto por un
 *   pago previo no se vuelve a aplicar aunque la fila vigente lo muestre lleno.
 * - Interés/IVA = máx(0, saldo de la fila − ya abonado por hermanos DISTINTOS a
 *   la fila vigente). No hay objetivo plano confiable para estos rubros, así
 *   que se restan los abonos de los otros hermanos (lo que una fila stale
 *   re-aplicaría) sin tocar lo que la propia fila ya refleja.
 * - El capital absorbe el faltante real restante tras los demás rubros, sin
 *   exceder lo que indica la fila vigente.
 *
 * En una cuota fresca (sin hermanos) es no-op: objetivo − 0 == lo que ya trae
 * la fila, interés/IVA − 0 == la fila, y capital == su saldo de fila.
 */
export const calcularSaldoNetoCuota = (
  i: SaldoCuotaInput
): SaldoCuotaNeto => {
  const cero = new Big(0);
  const noNeg = (b: Big) => (b.gt(cero) ? b : cero);
  const min = (a: Big, b: Big) => (a.lt(b) ? a : b);
  const saldoRubro = (saldoFila: Big, falta: Big) =>
    noNeg(min(saldoFila, falta));

  const montoCuota = new Big(i.montoCuota);
  const saldoRealCuota = noNeg(montoCuota.minus(i.aplicadoPrevioCuota));

  // Interés/IVA: la fila ya refleja su propia aplicación; restamos lo que
  // aplicaron los OTROS hermanos para no re-aplicarlo si la fila quedó stale.
  const interesRestante = noNeg(
    new Big(i.filaInteresRestante).minus(i.hermanosInteres)
  );
  const ivaRestante = noNeg(new Big(i.filaIvaRestante).minus(i.hermanosIva));
  const seguroRestante = saldoRubro(
    new Big(i.filaSeguroRestante),
    new Big(i.objetivoSeguro).minus(i.hermanosSeguro)
  );
  const gpsRestante = saldoRubro(
    new Big(i.filaGpsRestante),
    new Big(i.objetivoGps).minus(i.hermanosGps)
  );
  const membresiasRestante = saldoRubro(
    new Big(i.filaMembresiasRestante),
    new Big(i.objetivoMembresias).minus(i.hermanosMembresias)
  );
  const rubrosNoCapital = interesRestante
    .plus(ivaRestante)
    .plus(seguroRestante)
    .plus(gpsRestante)
    .plus(membresiasRestante);
  const capitalRestante = saldoRubro(
    new Big(i.filaCapitalRestante),
    saldoRealCuota.minus(rubrosNoCapital)
  );

  return {
    saldoRealCuota,
    interesRestante,
    ivaRestante,
    seguroRestante,
    gpsRestante,
    membresiasRestante,
    capitalRestante,
  };
};

export const applyCapitalPaymentAndBuildResponse = async (
  pago: { credito_id: number | null; abono_capital?: number | string | null },
  pagoId: number,
  applyCapitalAbono: (
    creditoId: number,
    abonoCapital: number | string,
    pagoId: number
  ) => Promise<unknown>
) => {
  if (pago.credito_id === null) {
    throw new Error("No se puede aplicar el abono: credito_id es null");
  }

  const resultado = await applyCapitalAbono(
    pago.credito_id,
    pago.abono_capital ?? "0",
    pagoId
  );
  console.log("⚠️ El pago es un abono directo a capital");
  // Propagar el estado del recálculo de recibos pendientes: si falló (o se
  // omitió por solo-interés), el caller debe enterarse para correr
  // "Recalcular Pagos" a mano — no puede quedarse solo en los logs.
  const recalculo_pendientes = (
    resultado as { recalculo_pendientes?: string } | null | undefined
  )?.recalculo_pendientes;
  return {
    success: true,
    applied: false,
    ...(recalculo_pendientes ? { recalculo_pendientes } : {}),
    message:
      "Pago validado como abono a capital , se abonó a inversionistas correctamente",
  };
};

// Tolerancia de un centavo por redondeos al comparar el capital contra cero.
export const INCOBRABLE_CAPITAL_TOLERANCE = 0.01;

/**
 * Regla de cierre de cuota para créditos en estado INCOBRABLE.
 *
 * Al castigar un crédito queda una sola cuota que representa el capital
 * incobrable y se va recuperando con pagos parciales. NO se puede usar la suma
 * de `monto_aplicado` para decidir si la cuota quedó pagada: filas
 * estructurales (reset / `system_reset`, `SISTEMA-INCOBRABLE`) contaminan esa
 * suma y cerrarían la cuota sin recuperación real (ver crédito 23 / SIFCO
 * 01010214119670, donde una fila `system_reset` de 6,272.54 marcaba la cuota
 * como pagada mientras el capital seguía en 7,744.11).
 *
 * Criterio fiel: la cuota se marca pagada si y solo si el capital del crédito
 * llega a 0 (≤ tolerancia) después de aplicar el `abono_capital` de este pago.
 *
 * @returns `true`/`false` cuando el crédito es INCOBRABLE; `null` cuando la
 *   regla NO aplica (cualquier otro estado), para que el caller conserve su
 *   lógica normal basada en la suma de `monto_aplicado`.
 */
export const shouldIncobrableInstallmentBePaid = ({
  statusCredit,
  capital,
  abonoCapital,
}: {
  statusCredit?: string | null;
  capital?: string | number | null;
  abonoCapital?: string | number | null;
}): boolean | null => {
  if (statusCredit !== "INCOBRABLE") return null;

  const capitalDespuesDelPago = new Big(capital ?? 0).minus(new Big(abonoCapital ?? 0));
  return capitalDespuesDelPago.lte(INCOBRABLE_CAPITAL_TOLERANCE);
};

/**
 * Recalcula capital / cuota_interes / iva_12 / deudatotal de un crédito tras un
 * cambio de capital, aplicando dos invariantes:
 *  - El capital nunca queda NEGATIVO (una sobre-recuperación se clampa a 0).
 *  - Un crédito INCOBRABLE NO devenga interés: cuota_interes = iva_12 = 0. El
 *    castigo preserva `porcentaje_interes`, así que recalcular interés sobre él
 *    reviviría deuda fantasma en un castigado (que es capital-only).
 *
 * `newCapital` es el capital YA calculado por el caller (capital ± abono).
 */
export const recomputeCreditAfterCapital = ({
  statusCredit,
  newCapital,
  porcentajeInteres,
  seguro = 0,
  gps = 0,
  membresias = 0,
}: {
  statusCredit?: string | null;
  newCapital: string | number | Big | null;
  porcentajeInteres?: string | number | null;
  seguro?: string | number | null;
  gps?: string | number | null;
  membresias?: string | number | null;
}) => {
  let capital = new Big(newCapital ?? 0);
  if (capital.lt(0)) capital = new Big(0);

  const cuotaInteres =
    statusCredit === "INCOBRABLE"
      ? new Big(0)
      : capital.times(new Big(porcentajeInteres ?? 0).div(100)).round(2);
  const iva = cuotaInteres.times(0.12).round(2);
  const deudaTotal = capital
    .plus(cuotaInteres)
    .plus(iva)
    .plus(new Big(seguro ?? 0))
    .plus(new Big(gps ?? 0))
    .plus(new Big(membresias ?? 0))
    .round(2);

  return { capital, cuotaInteres, iva, deudaTotal };
};

/**
 * ¿El pago debe pasar por processConvenioPayment? Solo créditos EN_CONVENIO y
 * solo si después de otros/abono-capital/mora todavía queda plata (orden
 * canónico del split, espejo del desglose del front: otros → mora → convenio).
 */
export const debeProcesarConvenio = ({
  statusCredit,
  disponible,
}: {
  statusCredit?: string | null;
  disponible: BigInput;
}) => statusCredit === "EN_CONVENIO" && new Big(disponible).gt(0);

/**
 * Cuánto aplicar al convenio en un pago. Topa al MENOR entre la cuota mensual
 * y el monto_pendiente real: tras un abono parcial previo el pendiente puede
 * ser menor que la cuota mensual, y sin este tope el ledger del convenio se
 * acreditaría por encima de lo que realmente se debe (monto_pendiente en
 * negativo, cuotas del convenio marcadas de más y reversos que revientan).
 * El monto NO se resta del disponible del pago — es registro del catch-up,
 * la boleta sigue pagando las cuotas corrientes completa.
 * `pagoCompleto` = el pago cubre el tope (>0): marca cuota del convenio y
 * contadores; un tope en 0 (convenio ya saldado) nunca cuenta como completo.
 */
export const calcularAplicacionConvenio = ({
  montoPago,
  cuotaMensual,
  montoPendiente,
}: {
  montoPago: BigInput;
  cuotaMensual: BigInput;
  montoPendiente: BigInput;
}): { montoAplicar: Big; pagoCompleto: boolean } => {
  const cuota = new Big(cuotaMensual);
  const pendiente = new Big(montoPendiente);
  const pago = new Big(montoPago);
  let tope = cuota.lt(pendiente) ? cuota : pendiente;
  if (tope.lt(0)) tope = new Big(0);
  if (pago.gte(tope)) {
    return { montoAplicar: tope, pagoCompleto: tope.gt(0) };
  }
  return { montoAplicar: pago.gt(0) ? pago : new Big(0), pagoCompleto: false };
};

/**
 * El convenio se cobra UNA sola vez por boleta (processConvenioPayment), pero la
 * boleta puede insertar varias filas en pagos_credito (cierre de una cuota +
 * parcial de la siguiente + abono a capital). Si todas cargaran el monto, cada
 * reverso restaría su pago_convenio de convenios_pago: la primera reversa deja
 * el convenio en cero y la segunda revienta con "No se puede revertir más de lo
 * que se ha pagado" (caso crédito 659 / convenio 98). Este estampador entrega
 * el monto a la PRIMERA fila que lo pide y "0" a todas las demás.
 */
export const crearEstampadorPagoConvenio = (
  montoConvenio: BigInput | null | undefined
) => {
  const monto = new Big(montoConvenio ?? 0);
  let estampado = false;
  return Object.assign(
    (): string => {
      if (estampado || monto.lte(0)) return "0";
      estampado = true;
      return monto.toString();
    },
    {
      /**
       * Peek NO consumidor: cuánto estamparía la próxima llamada. Lo usa el
       * loop de cuotas para decidir si una cuota sin saldo puede saltarse
       * (`debeInsertarFilaParcialCuota`) sin quemar el sello en la consulta.
       */
      pendiente: (): string =>
        estampado || monto.lte(0) ? "0" : monto.toString(),
    }
  );
};

/**
 * Cuántas cuotas del convenio quedan completadas según el monto ACUMULADO
 * (`monto_pagado` YA incluyendo el abono actual), no según el pago individual.
 * Con parciales habilitados, dos abonos de Q600 contra una cuota de Q1,000
 * deben completar la cuota al llegar el segundo — decidirlo por pago
 * individual (`pago >= cuota_mensual`) deja `pagos_realizados` y
 * `convenio_cuotas.fecha_pago` atrás del dinero y los recordatorios siguen
 * cobrando una cuota ya fondeada. `montoPendiente <= 0` completa todas las
 * cuotas de una vez: la última cuota real puede ser menor a la mensual por
 * redondeo de `total / meses` y el floor solo nunca la alcanzaría.
 */
export const calcularCuotasConvenioCompletadas = ({
  montoPagado,
  cuotaMensual,
  montoPendiente,
  numeroMeses,
}: {
  montoPagado: BigInput;
  cuotaMensual: BigInput;
  montoPendiente: BigInput;
  numeroMeses?: number | null;
}): number => {
  const meses = Math.max(0, Math.trunc(numeroMeses ?? 0));
  const cuota = new Big(cuotaMensual);
  if (new Big(montoPendiente).lte(0)) return meses;
  if (cuota.lte(0)) return 0;
  const completadas = Number(
    new Big(montoPagado).div(cuota).round(0, Big.roundDown).toString()
  );
  return Math.min(meses, completadas);
};

/**
 * Capital pedido que quedó SIN destino cuando el 409 se suprimió únicamente
 * porque el convenio escribió estado: la sección 7 no corrió (sin permiso ni
 * estaAlDia), el capital ya venía descontado de `montoEfectivo` y el saldo a
 * favor solo acredita `disponible_restante` — sin esta devolución ese monto se
 * evaporaría en silencio (P1 de Codex en #1246). Scoped a propósito: si mora/
 * otros/cuotas ya suprimían el rechazo ANTES de existir el convenio, se
 * conserva ese comportamiento pre-existente (ticket aparte).
 */
export const capitalSuprimidoPorConvenio = (params: {
  abonoCapital: BigInput;
  cuotasCompletas: number;
  cuotasParciales: number;
  moraAplicada: BigInput;
  otrosEspecialAplicado: boolean;
  convenioAplicado: BigInput;
}): Big => capitalSuprimidoSinAplicar({ ...params, cuotasSaltadas: 0 });

/**
 * ¿El cascadeo visitó cuotas, ninguna absorbió nada y NO se escribió ninguna
 * otra fila? Entonces el pago no dejó rastro alguno en `pagos_credito`.
 *
 * Antes del skip de cuotas sin saldo, esas cuotas dejaban filas basura que —
 * accidentalmente — servían de rastro: un reintento de la misma boleta se
 * detectaba como duplicado. Sin ellas, el `else` final acreditaría
 * `disponible_restante` a `saldo_a_favor` y respondería `success` sin fila ni
 * boleta persistida, así que reenviar la misma boleta/autorización acreditaría
 * saldo DOBLE sin evidencia (P2 de Codex en #1248).
 *
 * Se RECHAZA con 409 en lugar de insertar una fila especial de saldo a favor:
 * una fila con `monto_aplicado = 0` es permanentemente invalidable
 * (`shouldRejectZeroAppliedNormalValidation`), o sea exactamente el artefacto
 * que este PR elimina. Un crédito donde ninguna cuota abierta puede absorber
 * es un crédito degenerado que necesita reparación, y el 409 ruidoso-seguro es
 * la filosofía ya adoptada por el gate de integridad de #1229.
 *
 * `cuotasSaltadas > 0` es la condición clave: si el loop nunca corrió (crédito
 * sin cuotas pendientes) NO se rechaza, se conserva el flujo histórico de
 * saldo a favor. Y cualquier otra vía que YA escribió su fila (mora, la rama
 * especial de otros, o el convenio — que con el fix del sello fuerza fila en
 * la primera cuota, dejando `cuotasParciales > 0`) desactiva el rechazo.
 */
export const debeRechazarPagoSinAplicacion = ({
  cuotasSaltadas,
  cuotasCompletas,
  cuotasParciales,
  moraAplicada,
  otrosEspecialAplicado,
  convenioAplicado,
}: {
  cuotasSaltadas: number;
  cuotasCompletas: number;
  cuotasParciales: number;
  moraAplicada: BigInput;
  otrosEspecialAplicado: boolean;
  convenioAplicado: BigInput;
}): boolean =>
  cuotasSaltadas > 0 &&
  cuotasCompletas === 0 &&
  cuotasParciales === 0 &&
  new Big(moraAplicada ?? 0).lte(0) &&
  !otrosEspecialAplicado &&
  new Big(convenioAplicado ?? 0).lte(0);

/**
 * Generalización de lo anterior: capital pedido que se evaporaría porque el
 * 409 anti-pérdida quedó suprimido por algo que NO aplicó ese capital. Hoy hay
 * dos supresores de esa clase:
 *
 *  - el convenio (`convenioAplicado`, caso #1246), y
 *  - las cuotas saltadas (`cuotasSaltadas`), que se suman a `cuotasParciales`
 *    por paridad con develop — allá las filas basura de las cuotas sin saldo
 *    contaban como parciales y suprimían el 409.
 *
 * Se compara contra el escenario CRUDO (sin convenio y con las parciales
 * REALES): si ahí se rechazaría y con los supresores no, el capital vuelve a
 * saldo a favor. Al ser UN solo cómputo, si ambas supresiones coinciden el
 * capital se devuelve UNA vez, no dos.
 */
export const capitalSuprimidoSinAplicar = (params: {
  abonoCapital: BigInput;
  cuotasCompletas: number;
  cuotasParciales: number;
  moraAplicada: BigInput;
  otrosEspecialAplicado: boolean;
  convenioAplicado: BigInput;
  cuotasSaltadas?: number;
}): Big =>
  debeRechazarAbonoCapitalNoAplicado({
    ...params,
    convenioAplicado: 0,
    cuotasParciales: params.cuotasParciales - (params.cuotasSaltadas ?? 0),
  }) && !debeRechazarAbonoCapitalNoAplicado(params)
    ? new Big(params.abonoCapital ?? 0)
    : new Big(0);

/**
 * ¿Esta cuota merece una fila de pago parcial?
 *
 * El loop de cuotas de `insertPayment` cascadea mientras quede
 * `disponible_restante`, y hasta ahora insertaba una fila `pending` (más su
 * boleta) por cada cuota visitada AUNQUE la cuota no absorbiera nada. En el
 * crédito 8717 (INCOBRABLE migrado del CRM: toda la deuda concentrada en la
 * última cuota y las cuotas 2-62 con recibos `no_required` de capital 0 y
 * rubros que el saldo neto clampea a 0) una boleta de Q2,330 dejó 60 filas con
 * `monto_aplicado = 0` y la misma boleta colgada 61 veces. Esas filas son
 * basura permanente: `/aplicar-pago` rechaza validar un pago con monto
 * aplicado 0, así que nunca se pueden cerrar ni facturar.
 *
 * Regla: una cuota que no cobró nada (sin abonos, sin mora, sin otros, sin
 * convenio pendiente de estampar) no escribe fila ni boleta; el loop
 * simplemente sigue a la siguiente cuota con el disponible intacto.
 *
 * `pagoConvenio` es lo que el estampador escribiría en ESTA fila (su peek
 * `pendiente()`, no una llamada consumidora). En EN_CONVENIO,
 * `processConvenioPayment` ya mutó `convenios_pago` ANTES del loop y el sello
 * vive en una sola fila de `pagos_credito`: si todas las cuotas se saltaran,
 * el convenio quedaría cobrado sin fila que lo registre y se romperían la
 * reversa y la detección de boleta duplicada (P2 de Codex en #1248). Una fila
 * con `monto_aplicado = 0` pero `pagoConvenio > 0` es legítima y validable
 * (`shouldRejectZeroAppliedNormalValidation` exime pagoConvenio > 0).
 */
export const debeInsertarFilaParcialCuota = ({
  totalPagado,
  mora = 0,
  otros = 0,
  pagoConvenio = 0,
}: {
  totalPagado: BigInput;
  mora?: BigInput | null;
  otros?: BigInput | null;
  pagoConvenio?: BigInput | null;
}): boolean =>
  new Big(totalPagado ?? 0).gt(0) ||
  new Big(mora ?? 0).gt(0) ||
  new Big(otros ?? 0).gt(0) ||
  new Big(pagoConvenio ?? 0).gt(0);
