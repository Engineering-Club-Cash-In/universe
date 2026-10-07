import Big from "big.js";
import {
  calcularCoberturaCuota,
  getAjusteFechaIdealADeducir,
} from "../controllers/registerPaymentPolicy";
import { DIAS_PAGO_PENDIENTE_FRENA_MORA } from "./cuotaYaPagadaSql";
import { fechaCalendarioGT } from "./fechaCalendarioGT";
import {
  moraPendientePorCuota,
  repartirPagoDeMora,
  type CuotaParaPendiente,
} from "./moraPendiente";

/**
 * Condonación de la mora de un pago Nexa (ACH) que llegó a tiempo — la regla
 * PURA, sin base de datos.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 * El cliente paga su cuota por transferencia ACH vía Nexa y el dinero llega
 * 1–3 días hábiles después. Nexa no informa la fecha de envío (su `tokenDate`
 * es solo el día contable). Mientras tanto el cron le genera mora a la cuota,
 * el pago la cobra primero y la cuota queda abierta por el monto de esa mora.
 *
 * ── La regla (decisiones del dueño del dominio) ─────────────────────────────
 *  1. El cron no cambia: sí genera mora.
 *  2. Al entrar el pago se condona la mora de la(s) cuota(s) cuyo vencimiento
 *     + 3 días hábiles es ≥ la fecha del banco (`tokenDate`).
 *  3. SOLO si con ese pago el crédito queda al día. Si no, nada.
 *  4. La mora de cuotas vencidas antes (fuera de la ventana) se cobra normal.
 *  5. Días hábiles: lunes a viernes menos los feriados bancarios de Guatemala
 *     (`FERIADOS_FIJOS_GT` + Jueves y Viernes Santo).
 *
 * Para saber si "queda al día" se simula el reparto en el MISMO orden que
 * `insertPayment`: mora legítima → rubros → ajuste por fecha ideal → cuotas de
 * la más vieja a la más nueva. Cualquier error de estimación de los saldos va
 * en la dirección conservadora (saldo de cuota sobrestimado ⇒ no se condona).
 */

export const DIAS_HABILES_VENTANA_NEXA = 3;
export const MOTIVO_CONDONACION_NEXA_A_TIEMPO = "NEXA_ACH_A_TIEMPO";
/** Se agrega al motivo de la condonación si, aplicado el pago, el crédito no quedó al día. */
export const ALERTA_CONDONACION_NEXA_SIN_AL_DIA = "ALERTA: el crédito no quedó al día tras aplicar el pago";
/**
 * Se agregan al motivo de una condonación viva que se decidió CONSERVAR con el
 * pago Nexa incierto (manual_review). De ahí sale lo que cartera le informa a
 * nexa-server en cada 503 de ese evento, también en los reintentos.
 */
export const MARCA_CONDONACION_NEXA_CONSERVADA_AL_DIA =
  "CONSERVADA: pago Nexa incierto, pero con lo que entró el crédito quedó al día";
export const MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_COMPLETO =
  "CONSERVADA: pago Nexa incierto, pero sus filas suman el monto completo";
export const MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_POSTERIOR =
  "CONSERVADA: hay un pago posterior no vinculado que pudo ser esta transferencia";
/**
 * Se agrega al motivo de una condonación que se sostiene en pagos PENDIENTES
 * (ver `pagos_pendientes_ids`, drizzle/0052): así se lee en el reporte.
 */
export const MARCA_CONDONACION_NEXA_CON_PAGO_PENDIENTE = "CON PAGO PENDIENTE";

/** El motivo de la condonación a tiempo; con pagos pendientes que la sostienen, lo dice. */
export function motivoCondonacionNexaATiempo(pagosPendientes: number[]): string {
  if (pagosPendientes.length === 0) return MOTIVO_CONDONACION_NEXA_A_TIEMPO;
  return `${MOTIVO_CONDONACION_NEXA_A_TIEMPO} — ${MARCA_CONDONACION_NEXA_CON_PAGO_PENDIENTE}: `
    + `se sostiene en ${pagosPendientes.length === 1 ? "el pago" : "los pagos"} ${pagosPendientes.join(", ")}`
    + ", si no se valida(n) se anula";
}

/** Feriados bancarios de fecha fija (MM-DD). 24 y 31-dic no son hábiles por decisión de negocio. */
export const FERIADOS_FIJOS_GT = [
  "01-01", // Año Nuevo
  "05-01", // Día del Trabajo
  "06-30", // Día del Ejército
  "07-01", // Día del empleado bancario
  "08-15", // Asunción (feriado del departamento de Guatemala)
  "09-15", // Independencia
  "10-20", // Revolución
  "11-01", // Todos los Santos
  "12-24", // Nochebuena
  "12-25", // Navidad
  "12-31", // Fin de año
] as const;

const DIA_MS = 86_400_000;

const aMs = (fecha: Date | string): number => {
  const ms = fechaCalendarioGT(fecha);
  if (!Number.isFinite(ms)) throw new Error(`Fecha inválida: ${String(fecha)}`);
  return ms;
};

const aYmd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Domingo de Pascua (calendario gregoriano), algoritmo de Meeus/Jones/Butcher. */
export function domingoDePascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return aYmd(Date.UTC(anio, mes - 1, dia));
}

/** Todos los feriados bancarios de Guatemala de un año, como `YYYY-MM-DD`. */
export function feriadosBancariosGT(anio: number): Set<string> {
  const pascua = aMs(domingoDePascua(anio));
  return new Set([
    ...FERIADOS_FIJOS_GT.map((mmdd) => `${anio}-${mmdd}`),
    aYmd(pascua - 3 * DIA_MS), // Jueves Santo
    aYmd(pascua - 2 * DIA_MS), // Viernes Santo
  ]);
}

/** ¿Es día hábil bancario en Guatemala? (lunes a viernes, sin feriados). */
export function esDiaHabilGT(fecha: Date | string): boolean {
  const ms = aMs(fecha);
  const diaSemana = new Date(ms).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  return !feriadosBancariosGT(new Date(ms).getUTCFullYear()).has(aYmd(ms));
}

/**
 * La fecha que cae `n` días hábiles DESPUÉS de `fecha` (la propia fecha no
 * cuenta). Devuelve `YYYY-MM-DD`.
 */
export function sumarDiasHabilesGT(fecha: Date | string, n: number): string {
  let ms = aMs(fecha);
  let faltan = n;
  while (faltan > 0) {
    ms += DIA_MS;
    if (esDiaHabilGT(aYmd(ms))) faltan -= 1;
  }
  return aYmd(ms);
}

/** ¿La fecha del banco cae dentro de vencimiento + 3 días hábiles? */
export function pagoNexaDentroDeVentana(
  fechaVencimiento: Date | string,
  fechaBanco: string,
): boolean {
  return aMs(fechaBanco) <= aMs(sumarDiasHabilesGT(fechaVencimiento, DIAS_HABILES_VENTANA_NEXA));
}

type BigInput = Big | string | number;

/** Una cuota que HOY devenga mora, con el criterio del cron (`cuotasParaPendienteDeCreditos`). */
export type CuotaConMoraNexa = CuotaParaPendiente & { fecha_vencimiento: Date | string };

/** Una cuota abierta del crédito, en el orden en que `insertPayment` la recorre (numero_cuota). */
export type CuotaAbiertaNexa = {
  cuota_id: number;
  numero_cuota: number;
  fecha_vencimiento: Date | string;
  /** Lo que le falta a la cuota (ver `saldoDeCuotaParaNexa`). */
  saldo: BigInput;
  /** Tiene un pago pendiente con plata (ver `cuotaConCierreDiferidoNexa`). */
  cierreDiferido?: boolean;
  /**
   * Los pagos PENDIENTES que cuentan en `saldo` (ver `pagosPendientesVigentesNexa`).
   * Si la cuota está vencida y el crédito queda al día, la condonación se
   * sostiene en ellos.
   */
  pagosPendientes?: number[];
};

/**
 * ¿La cuota tiene un pago PENDIENTE vivo con plata? Entonces el pago Nexa que
 * la complete NO la cierra: `aplicarPagoNormalEnTx` difiere el cierre hasta
 * que contabilidad valide ese hermano (la fila Nexa queda pagado=false) y, para
 * el cron, la cuota sigue vencida. El crédito no queda al día con este pago:
 * queda al día recién al validar el pendiente, y si se rechaza, nunca.
 */
export function cuotaConCierreDiferidoNexa(
  pagos: { validationStatus: string | null; paymentFalse: boolean | null; monto_aplicado: BigInput | null }[],
): boolean {
  return pagos.some((p) =>
    p.validationStatus === "pending" && p.paymentFalse === false && new Big(p.monto_aplicado ?? 0).gt(0));
}

type PagoParaSaldoNexa = Parameters<typeof calcularCoberturaCuota>[0]["pagos"][number] & {
  /** `pagos_credito.fecha_pago` (timestamp sin zona: su fecha de calendario). */
  fecha_pago: Date | string | null;
  /** `pagos_credito.pagado`: un pendiente solo cubre si lo trae en true (criterio del cron). */
  pagado?: boolean | null;
};

/**
 * Saldo de una cuota para la simulación: cuota mensual − Σ lo aplicado por
 * pagos vivos. Un pago PENDIENTE cuenta solo con el criterio del cron
 * (`hasPaidPaymentSql`): `pagado = true` y `fecha_pago` entre hoy −
 * `DIAS_PAGO_PENDIENTE_FRENA_MORA` y mañana. Un parcial pendiente
 * (`pagado = false`) no cubre la cuota para el cron, ni sumado con otros. Un pendiente olvidado de hace 30 días no cubre la cuota para el
 * cron —que le sigue cobrando mora—, así que tampoco puede darla por pagada
 * acá: se condonaría sin que el crédito quede al día.
 */
export function saldoDeCuotaParaNexa(
  montoCuota: BigInput,
  pagos: PagoParaSaldoNexa[],
  hoy: Date | string,
): Big {
  const hoyMs = aMs(hoy);
  const vigentes = pagos.filter((p) => p.validationStatus !== "pending" || pendienteEnVentanaNexa(p, hoyMs));
  return calcularCoberturaCuota({ montoCuota, pagos: vigentes, incluirPendientes: true }).saldoPendiente;
}

const pendienteEnVentanaNexa = (p: { fecha_pago: Date | string | null; pagado?: boolean | null }, hoyMs: number) => {
  if (p.pagado !== true) return false; // el cron exige pc.pagado = true
  if (p.fecha_pago == null) return false; // NULL no pasa la ventana en SQL
  const pagoMs = aMs(p.fecha_pago);
  return pagoMs >= hoyMs - DIAS_PAGO_PENDIENTE_FRENA_MORA * DIA_MS && pagoMs <= hoyMs + DIA_MS;
};

/**
 * Los pago_id PENDIENTES vivos con plata que `saldoDeCuotaParaNexa` cuenta
 * (`pagado = true` y dentro de la ventana del cron). Si alguno se anula o se revierte sin
 * validarse, la cuota vuelve a deber y una condonación que se apoyó en él ya
 * no tiene sustento.
 */
export function pagosPendientesVigentesNexa(
  pagos: (PagoParaSaldoNexa & { pago_id: number; monto_aplicado: BigInput | null })[],
  hoy: Date | string,
): number[] {
  const hoyMs = aMs(hoy);
  return pagos
    .filter((p) => p.validationStatus === "pending" && p.paymentFalse !== true
      && new Big(p.monto_aplicado ?? 0).gt(0) && pendienteEnVentanaNexa(p, hoyMs))
    .map((p) => p.pago_id);
}

export type RazonSinCondonacionNexa =
  | "estado_no_aplica"
  | "sin_mora"
  | "fuera_de_ventana"
  | "no_alcanza_mora"
  | "no_queda_al_dia";

export type DecisionCondonacionNexa =
  | { condonar: false; razon: RazonSinCondonacionNexa }
  | {
      condonar: true;
      /** Total a condonar, en centavos. */
      monto: Big;
      /** Lo que queda de mora y cobra el pago (la mora legítima). */
      moraACobrar: Big;
      /** Reparto para el ledger, solo cuotas dentro de la ventana. */
      cuotas: { cuota_id: number; monto: Big }[];
      /**
       * Pagos pendientes de cuotas vencidas sin los que el crédito no quedaría
       * al día (ordenados, sin repetir). Vacío = no depende de ninguno.
       */
      pagosPendientes: number[];
    };

const TOLERANCIA_CUOTA = new Big("0.01");

export function decidirCondonacionNexaATiempo(params: {
  statusCredit: string | null;
  capital: BigInput | null;
  /** `moras_credito.monto_mora` de la mora ACTIVA, o null si no hay. */
  moraActiva: BigInput | null;
  cuotasConMora: CuotaConMoraNexa[];
  cuotasAbiertas: CuotaAbiertaNexa[];
  /** Monto del pago Nexa. */
  monto: BigInput;
  /** `tokenDate.slice(0, 10)`. */
  fechaBanco: string;
  /** Hoy en Guatemala: define qué cuotas siguen vencidas. */
  hoy: Date | string;
  /** Lo que los rubros vivos podrían tomar de la boleta (ver `cobrarRubrosParaBoleta`). */
  rubrosPendientes: BigInput;
  ajusteFechaIdeal: { id: number; monto_total: BigInput } | null;
}): DecisionCondonacionNexa {
  // EN_CONVENIO / INCOBRABLE / … no devengan mora (STATUS_EXCLUIDOS_MORA).
  if (!["ACTIVO", "MOROSO"].includes(params.statusCredit ?? "")) {
    return { condonar: false, razon: "estado_no_aplica" };
  }
  const moraActual = new Big(params.moraActiva ?? 0);
  if (moraActual.lte(0)) return { condonar: false, razon: "sin_mora" };

  // Cuotas duplicadas (mismo numero_cuota): insertPayment solo paga la de mayor cuota_id, que es la
  // única que llega en `cuotasAbiertas`. Una cuota con mora que no está ahí es la duplicada vieja:
  // queda sin pagar, así que el crédito no queda al día.
  const abiertas = new Set(params.cuotasAbiertas.map((c) => c.cuota_id));
  if (params.cuotasConMora.some((c) => !abiertas.has(c.cuota_id))) {
    return { condonar: false, razon: "no_queda_al_dia" };
  }

  const { porCuota } = moraPendientePorCuota({
    capital: params.capital ?? 0,
    cuotas: params.cuotasConMora,
  });
  const enVentana = new Set(
    params.cuotasConMora
      .filter((c) => pagoNexaDentroDeVentana(c.fecha_vencimiento, params.fechaBanco))
      .map((c) => c.cuota_id),
  );
  const pendientesVentana = porCuota.filter((c) => enVentana.has(c.cuota_id));
  const moraVentana = pendientesVentana.reduce((acc, c) => acc.plus(c.pendiente), new Big(0));
  const moraLegitima = porCuota
    .filter((c) => !enVentana.has(c.cuota_id))
    .reduce((acc, c) => acc.plus(c.pendiente), new Big(0));
  if (moraVentana.lte(0)) return { condonar: false, razon: "fuera_de_ventana" };

  // `monto_mora` es el total redondeado a centavos; la parte legítima se cobra
  // redondeada y el resto es de la ventana. El tope (la mora de la ventana
  // redondeada hacia arriba) evita condonar un ajuste manual que no le toca.
  const tope = moraVentana.round(2, Big.roundUp);
  const resto = moraActual.minus(moraLegitima.round(2, Big.roundHalfUp));
  const montoCondonar = (resto.lt(tope) ? resto : tope).round(2, Big.roundDown);
  if (montoCondonar.lte(0)) return { condonar: false, razon: "fuera_de_ventana" };
  const moraACobrar = moraActual.minus(montoCondonar);

  // ── Simulación del reparto de insertPayment ────────────────────────────────
  let disponible = new Big(params.monto);
  if (moraACobrar.gt(0)) {
    // Si no alcanza la mora, insertPayment corta y no paga ninguna cuota.
    if (disponible.lt(moraACobrar)) return { condonar: false, razon: "no_alcanza_mora" };
    disponible = disponible.minus(moraACobrar);
  }
  const rubros = new Big(params.rubrosPendientes || 0);
  disponible = disponible.minus(rubros.lt(disponible) ? rubros : disponible);
  const ajuste = getAjusteFechaIdealADeducir({
    tieneCuota1Pendiente: params.cuotasAbiertas.some((c) => c.numero_cuota === 1),
    ajustePendiente: params.ajusteFechaIdeal,
    disponible,
  });
  if (ajuste) disponible = disponible.minus(ajuste.monto);

  const hoyMs = aMs(params.hoy);
  const cuotas = [...params.cuotasAbiertas].sort((a, b) => a.numero_cuota - b.numero_cuota);
  const pagosPendientes = new Set<number>();
  for (const cuota of cuotas) {
    const saldo = new Big(cuota.saldo || 0);
    const toma = saldo.lt(disponible) ? saldo : disponible.gt(0) ? disponible : new Big(0);
    disponible = disponible.minus(toma);
    const vencida = aMs(cuota.fecha_vencimiento) < hoyMs;
    if (vencida && saldo.minus(toma).gt(TOLERANCIA_CUOTA)) {
      return { condonar: false, razon: "no_queda_al_dia" };
    }
    // El pago la completa, pero su cierre queda diferido a la validación del
    // pendiente: el crédito no queda al día con este pago.
    if (vencida && cuota.cierreDiferido && toma.gt(0)) {
      return { condonar: false, razon: "no_queda_al_dia" };
    }
    // Vencida y ya cubierta por pendientes (este pago no le pone nada: el
    // parcial que este pago completaría se rechazó arriba): el crédito queda al
    // día gracias a ellos —el cron le da 7 días a un pendiente—. La condonación
    // se marca con ellos y se anula si alguno se anula o se revierte sin validarse.
    if (vencida) for (const id of cuota.pagosPendientes ?? []) pagosPendientes.add(id);
  }

  const { reparto } = repartirPagoDeMora({ monto: montoCondonar, porCuota: pendientesVentana });
  return {
    condonar: true,
    monto: montoCondonar,
    moraACobrar,
    cuotas: reparto,
    pagosPendientes: [...pagosPendientes].sort((a, b) => a - b),
  };
}
