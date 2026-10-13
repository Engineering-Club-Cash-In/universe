/**
 * Plan de pagos de un convenio y su reprogramación (COBROS-02 M4, issue #1895).
 * Reglas puras; el acceso a la base vive en controllers/convenioPlan.ts.
 */

export type EstadoConvenio = "pendiente" | "activo" | "completado" | "anulado";

/**
 * `convenios_pago` no tiene columna de estado: se deduce. Pendiente de
 * aprobación = ni activo, ni completado, ni anulado (el rechazo borra la fila).
 */
export function estadoDeConvenio(c: {
  activo: boolean;
  completado: boolean;
  anulado_at: Date | string | null;
}): EstadoConvenio {
  if (c.anulado_at) return "anulado";
  if (c.completado) return "completado";
  return c.activo ? "activo" : "pendiente";
}

/** Redondeo a centavos sin errores de coma flotante. */
export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function cuotaMensualDe(total: number, meses: number): number {
  return redondear2(total / meses);
}

/** Día calendario (YYYY-MM-DD) de un instante en Guatemala. */
export function diaGuatemala(instante: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(instante);
}

/**
 * Fecha del primer pago del plan: la primera cuota (por número) que vence desde
 * el día del convenio. Las cuotas que el convenio tomó del crédito pueden traer
 * fechas ya vencidas (las que se reestructuran); esas no son el primer pago.
 * Si todas vencen antes, se usa la primera del plan.
 */
export function primerPagoDelPlan(
  cuotas: readonly { numero_cuota: number; fecha_vencimiento: string }[],
  fechaConvenio: Date | string,
): string | null {
  if (cuotas.length === 0) return null;
  const ordenadas = [...cuotas].sort((a, b) => a.numero_cuota - b.numero_cuota);
  // `fecha_convenio` se guarda en UTC; las cuotas vencen en días de Guatemala. Un
  // convenio firmado por la tarde en Guatemala ya es «mañana» en UTC y descartaría
  // una cuota que vence ese mismo día.
  const desde = diaGuatemala(new Date(fechaConvenio));
  return (ordenadas.find((c) => c.fecha_vencimiento >= desde) ?? ordenadas[0]).fecha_vencimiento;
}

/**
 * Fechas mensuales del plan a partir del primer pago (YYYY-MM-DD). Conserva el
 * día del primer pago y, si el mes no lo tiene, usa su último día
 * (31 de enero → 28 de febrero → 31 de marzo).
 */
export function fechasDelPlan(primerPago: string, meses: number): string[] {
  const [anio, mes, dia] = primerPago.split("-").map(Number);
  return Array.from({ length: meses }, (_, i) => {
    const mesIndice = mes - 1 + i;
    const a = anio + Math.floor(mesIndice / 12);
    const m = ((mesIndice % 12) + 12) % 12;
    const ultimoDia = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    const d = Math.min(dia, ultimoDia);
    return `${a}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

/**
 * El primer pago de un plan reprogramado tiene que caer DESPUÉS del día en que
 * se firmó el convenio: los lectores de atraso (`convenioAlertas`,
 * `nacioConElConvenio`) tratan toda cuota con vencimiento en ese día o antes
 * como deuda vieja, y la primera cuota del plan nuevo nunca contaría.
 */
export function primerPagoPosteriorAlConvenio(primerPago: string, fechaConvenio: Date | string): boolean {
  return primerPago > diaGuatemala(new Date(fechaConvenio));
}

/** Tope duro de cartera; el tope de negocio (CONVENIO_MAX_MESES) lo aplica el CRM. */
export const MAX_MESES_REPROGRAMACION = 60;
export const MAX_DIAS_HASTA_PRIMER_PAGO = 90;

/** ¿Existe ese día en el calendario? («2026-02-31» pasa el formato pero no existe.) */
export function esFechaDeCalendario(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [a, m, d] = fecha.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Primer motivo por el que la reprogramación no es válida, o `null` si lo es. */
export function motivoReprogramacionInvalida(params: {
  meses: number;
  primerPago: string;
  hoy: string;
  maxMeses?: number;
}): string | null {
  const max = params.maxMeses ?? MAX_MESES_REPROGRAMACION;
  if (!Number.isInteger(params.meses) || params.meses < 1 || params.meses > max) {
    return `El número de cuotas debe estar entre 1 y ${max}.`;
  }
  if (!esFechaDeCalendario(params.primerPago)) {
    return "La fecha del primer pago no es válida.";
  }
  if (params.primerPago < params.hoy) {
    return "La fecha del primer pago no puede estar en el pasado.";
  }
  const limite = new Date(`${params.hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + MAX_DIAS_HASTA_PRIMER_PAGO);
  if (params.primerPago > limite.toISOString().slice(0, 10)) {
    return `El primer pago no puede ser dentro de más de ${MAX_DIAS_HASTA_PRIMER_PAGO} días.`;
  }
  return null;
}
