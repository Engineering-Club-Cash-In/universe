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
 *         AND validation_status IN ('validated','no_required')
 *         AND COALESCE(monto_aplicado, 0) > 0)
 *
 * La pantalla afirma en su leyenda que usa "el mismo criterio con el que el
 * sistema calcula la mora". Vive en `src/lib` para poder probar esa afirmación
 * sin montar la pantalla: si el backend cambia el criterio, el test de acá es
 * el que avisa.
 */

/**
 * Estados que por política NO devengan mora. Espejo de `STATUS_EXCLUIDOS_MORA`
 * en `cartera-back/src/controllers/latefee.ts`.
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
  statusCredit?: string | null;
}

/**
 * ¿Este pago CUBRE la cuota a la que está colgado?
 *
 * `COALESCE(monto_aplicado,0) > 0` no es un detalle: los pagos especiales (solo
 * mora / otros / convenio) y las famosas filas-cero se cuelgan de la cuota con
 * `pagado = true` y `monto_aplicado = 0` SIN cubrirla. Sin esa condición la
 * cuota se pintaba como cubierta mientras el backend le seguía cobrando mora.
 */
export function pagoCubreCuota(p: PagoParaAtraso): boolean {
  return (
    p.paymentFalse === false &&
    p.pagado === true &&
    (p.validationStatus === "validated" || p.validationStatus === "no_required") &&
    Number(p.monto_aplicado ?? 0) > 0
  );
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

    if (pagoCubreCuota(p)) cubiertas.add(p.cuota_id);

    // Estado excluido: la cuota no devenga mora, así que no se marca (pero el
    // pago sí pudo haber entrado a `cubiertas` arriba, que es inocuo).
    if (!devengaMora(p.statusCredit)) continue;

    // El criterio canónico exige exactamente `pagado = false`; null no califica.
    if (p.cuota_pagada !== false) continue;

    const venc = String(p.fecha_vencimiento ?? "").slice(0, 10);
    if (venc && venc < hoy) vencidas.set(p.cuota_id, venc);
  }

  for (const cuotaId of cubiertas) vencidas.delete(cuotaId);
  return vencidas;
}
