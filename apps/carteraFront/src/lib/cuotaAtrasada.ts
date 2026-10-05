/**
 * Criterio de "cuota en atraso" del historial de pagos.
 *
 * Es el ESPEJO EXACTO del criterio con el que la mora se calcula en el backend
 * (`cartera-back/src/controllers/latefee.ts`: `isOverdueInstallmentForMora` +
 * el SQL de "cuotas vencidas reales" de `editarMoraManual`):
 *
 *    cuotas_credito.fecha_vencimiento < hoy (America/Guatemala)
 *    AND cuotas_credito.pagado = false
 *    AND creditos."statusCredit" NOT IN (STATUS_EXCLUIDOS_MORA)
 *    AND NOT EXISTS pago que la cubra
 *        (paymentFalse = false AND pagado = true
 *         AND COALESCE(monto_aplicado, 0) > 0
 *         AND (validation_status IN ('validated','no_required')
 *              OR (validation_status = 'pending'
 *                  AND fecha_pago::date >= hoy_GT - 7
 *                  AND fecha_pago::date <= hoy_GT + 1)))
 *
 * (`hasPaidPaymentSql` en `cartera-back/src/utils/cuotaYaPagadaSql.ts`.)
 *
 * La pantalla afirma en su leyenda que usa "el mismo criterio con el que el
 * sistema calcula la mora". Vive en `src/lib` para poder probar esa afirmación
 * sin montar la pantalla: si el backend cambia el criterio, el test de acá es
 * el que avisa.
 */

/**
 * Estados que por política NO devengan mora. Espejo de `STATUS_EXCLUIDOS_MORA`
 * en `cartera-back/src/constants/creditStatus.ts`, que es donde vive la lista
 * desde que dejó de estar dentro de `latefee.ts` (aquél la re-exporta, así que
 * el puntero viejo llevaba a un archivo que ya no la define).
 */
export const STATUS_EXCLUIDOS_MORA = [
  "EN_CONVENIO",
  "INCOBRABLE",
  "CANCELADO",
  "PENDIENTE_CANCELACION",
  "CAIDO",
] as const;

export const devengaMora = (statusCredit?: string | null): boolean =>
  !STATUS_EXCLUIDOS_MORA.includes(
    (statusCredit ?? "") as (typeof STATUS_EXCLUIDOS_MORA)[number]
  );

/** Fila de pago tal como la devuelve `getAllPagosWithCreditAndInversionistas`. */
export interface PagoParaAtraso {
  cuota_id?: number | null;
  /** `pagado` de la CUOTA (no el del pago). */
  cuota_pagada?: boolean | null;
  fecha_vencimiento?: string | Date | null;
  paymentFalse?: boolean | null;
  pagado?: boolean | null;
  validationStatus?: string | null;
  monto_aplicado?: string | number | null;
  /** Fecha del pago: la edad de un pago pendiente se mide con ella. */
  fecha_pago?: string | Date | null;
  statusCredit?: string | null;
}

/**
 * Días que un pago pendiente de validación frena la mora de su cuota. Espejo
 * de `DIAS_PAGO_PENDIENTE_FRENA_MORA` en el backend: contabilidad valida días
 * después del cobro y, mientras tanto, no se le cobra mora a quien pagó a
 * tiempo; con tope, porque hay pendientes olvidados que la frenarían siempre.
 */
export const DIAS_PAGO_PENDIENTE_FRENA_MORA = 7;

/**
 * ¿Este pago CUBRE la cuota a la que está colgado?
 *
 * `COALESCE(monto_aplicado,0) > 0` no es un detalle: los pagos especiales (solo
 * mora / otros / convenio) y las famosas filas-cero se cuelgan de la cuota con
 * `pagado = true` y `monto_aplicado = 0` SIN cubrirla. Sin esa condición la
 * cuota se pintaba como cubierta mientras el backend le seguía cobrando mora.
 * Un pago PENDIENTE cubre solo mientras tenga ≤7 días (`pendienteVigente`).
 */
type EstadoVisible = { label: string; tone: "blue" | "amber" | "green" | "red" };

export function estadoVisiblePago(p: Pick<
  PagoParaAtraso,
  "pagado" | "paymentFalse" | "validationStatus" | "cuota_pagada"
>): { registro: EstadoVisible; validacion: EstadoVisible; cuota: EstadoVisible } {
  const anulado = p.paymentFalse === true;
  return {
    registro: anulado
      ? { label: "Pago anulado", tone: "red" }
      : {
          label: p.pagado === true ? "Registrado completo" : "Registrado parcial",
          tone: "blue",
        },
    validacion: anulado
      ? { label: "No válido", tone: "red" }
      : p.validationStatus === "validated" || p.validationStatus === "capital_validated" || p.validationStatus === "reset"
        ? { label: "Validado", tone: "green" }
        : p.validationStatus === "no_required"
          ? { label: "No requiere validación", tone: "blue" }
          : { label: "Validación pendiente", tone: "amber" },
    cuota: p.cuota_pagada === true
      ? { label: "Cuota pagada", tone: "green" }
      : { label: "Cuota pendiente", tone: "amber" },
  };
}

export function pagoCubreCuota(p: PagoParaAtraso, hoy: string = hoyGT()): boolean {
  if (p.paymentFalse !== false || p.pagado !== true) return false;
  if (!(Number(p.monto_aplicado ?? 0) > 0)) return false;
  if (p.validationStatus === "validated" || p.validationStatus === "no_required") return true;
  return p.validationStatus === "pending" && pendienteVigente(p.fecha_pago, hoy);
}

/**
 * ¿El pago pendiente tiene a lo sumo `DIAS_PAGO_PENDIENTE_FRENA_MORA` días?
 * Mismo corte que el SQL: `hoy − 7 <= fecha_pago::date <= hoy + 1`, en días
 * de calendario (el tope de arriba impide que una fecha futura alargue el
 * freno; se admite mañana por las filas guardadas en UTC). `fecha_pago` es un `timestamp` sin zona que el JSON trae como
 * "…T…Z": su día se lee por los componentes UTC (`diaVencimiento`), igual que
 * el `::date` de Postgres. Sin fecha no hay cómo acotarlo: no cubre.
 */
function pendienteVigente(fechaPago: string | Date | null | undefined, hoy: string): boolean {
  const dia = diaVencimiento(fechaPago);
  if (!dia) return false;
  const desde = new Date(`${hoy}T00:00:00Z`);
  desde.setUTCDate(desde.getUTCDate() - DIAS_PAGO_PENDIENTE_FRENA_MORA);
  const hasta = new Date(`${hoy}T00:00:00Z`);
  hasta.setUTCDate(hasta.getUTCDate() + 1);
  return dia >= desde.toISOString().slice(0, 10) && dia <= hasta.toISOString().slice(0, 10);
}

/**
 * Día `YYYY-MM-DD` del vencimiento, venga como string o como `Date`.
 *
 * `String(new Date(...)).slice(0, 10)` produce `"Fri Aug 01"`, que comparado
 * contra `"2026-09-09"` da SIEMPRE falso: la cuota vencida se caía del mapa en
 * silencio. Un `Date` se lee por sus componentes UTC porque es como llega:
 * `fecha_vencimiento` es una columna `date` y el JSON la trae como
 * "2026-08-01"/"2026-08-01T00:00:00.000Z", que `new Date()` ancla a medianoche
 * UTC —usar los componentes locales la correría al día anterior en Guatemala.
 */
export function diaVencimiento(
  v?: string | Date | null
): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  }
  return String(v).slice(0, 10);
}

/** Día `YYYY-MM-DD` de hoy en Guatemala; "en-CA" ya produce ese formato. */
export const hoyGT = (ahora: Date = new Date()): string =>
  ahora.toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });

/**
 * Mapa `cuota_id -> fecha_vencimiento` de las cuotas en atraso.
 *
 * Se calcula sobre TODOS los pagos del crédito (no sobre los filtrados por
 * mes/año) para que el filtro de la pantalla no esconda el pago que sí cubre
 * la cuota.
 */
export function cuotasEnAtraso(
  filas: Array<{ pago?: PagoParaAtraso | null } | null | undefined>,
  hoy: string = hoyGT()
): Map<number, string> {
  const vencidas = new Map<number, string>();
  const cubiertas = new Set<number>();

  for (const item of filas ?? []) {
    const p = item?.pago;
    if (!p || p.cuota_id == null) continue;

    if (pagoCubreCuota(p, hoy)) cubiertas.add(p.cuota_id);

    // Estado excluido: la cuota no devenga mora, así que no se marca (pero el
    // pago sí pudo haber entrado a `cubiertas` arriba, que es inocuo).
    if (!devengaMora(p.statusCredit)) continue;

    // El criterio canónico exige exactamente `pagado = false`; null no califica.
    if (p.cuota_pagada !== false) continue;

    const venc = diaVencimiento(p.fecha_vencimiento);
    if (venc && venc < hoy) vencidas.set(p.cuota_id, venc);
  }

  for (const cuotaId of cubiertas) vencidas.delete(cuotaId);
  return vencidas;
}
