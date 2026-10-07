/**
 * Filtros de la pantalla "Pagos con Inversionistas" para el cierre diario de
 * Contabilidad (5 pm): canal (Nexa / manual) y rango de fecha de pago con hora.
 *
 * Con hora, el backend filtra por la hora de REGISTRO del pago en Guatemala
 * (manual: fecha_pago; Nexa: cuándo entró a cartera). "Desde" incluye la hora y
 * "hasta" no: un pago a las 17:00:00 en punto cae en el cierre siguiente.
 */

import { diaISOGT } from "./fechaGT";

export type CanalPago = "" | "NEXA" | "MANUAL";

export const HORA_CIERRE = "17:00";

/** Resta días a un `YYYY-MM-DD` sin pasar por la zona del navegador. */
const restarDias = (dia: string, n: number): string => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - n)).toISOString().slice(0, 10);
};

/** Cierre de las 5 pm: desde ayer 17:00 hasta hoy 17:00, con "hoy" en Guatemala. */
export function cierreCincoPm(ahora: Date = new Date()) {
  const hoy = diaISOGT(ahora);
  return { fechaInicio: restarDias(hoy, 1), horaInicio: HORA_CIERRE, fechaFin: hoy, horaFin: HORA_CIERRE };
}

/**
 * Parámetros del modo "Rango": cada hora solo viaja si se llenó Y si su fecha está presente
 * (el backend responde 422 a una hora sin la fecha que le corresponde).
 */
export function paramsRangoFechaPago(r: { fechaInicio: string; fechaFin: string; horaInicio: string; horaFin: string }) {
  return {
    fechaInicio: r.fechaInicio || undefined,
    fechaFin: r.fechaFin || undefined,
    horaInicio: r.fechaInicio && r.horaInicio ? r.horaInicio : undefined,
    horaFin: r.fechaFin && r.horaFin ? r.horaFin : undefined,
  };
}

/** Etiqueta del canal en la fila; null si el pago fue manual. */
export function etiquetaCanal(pago: { entroPorNexa?: boolean | null; nexaEventoFallido?: boolean | null }) {
  if (pago.entroPorNexa !== true) return null;
  // Nexa rechazó la transferencia y devolvió la plata: no es un ingreso del cierre.
  return pago.nexaEventoFallido === true
    ? { label: "Nexa · rechazado", className: "bg-red-100 text-red-700" }
    : { label: "Nexa", className: "bg-emerald-100 text-emerald-800" };
}
