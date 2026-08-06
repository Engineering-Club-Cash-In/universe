/**
 * actualizarPagosExcelPolicy
 * ------------------------------------------------------------------
 * Predicados puros del sync de pagos contra el Excel de cartera. Viven aparte
 * del router para poder testearlos sin DB ni R2.
 */
import type { PagoCarteraExcel } from "../services/carteraExcelR2";

/** Fila del Excel: solo las columnas que representan plata cobrada en la cuota. */
export type FilaExcelMontos = Pick<
  PagoCarteraExcel,
  | "abono_capital"
  | "abono_interes"
  | "abono_iva_12"
  | "abono_interes_ci"
  | "abono_iva_ci"
  | "abono_seguro"
  | "abono_gps"
  | "membresias_pago"
  | "pago_del_mes"
  | "mora"
  | "otros"
>;

/**
 * Pago de la DB. Los `numeric` de drizzle llegan como string y `otros` es
 * text, así que todo entra como unknown y se normaliza acá.
 */
export type PagoDbMontos = {
  monto_aplicado?: unknown;
  pago_del_mes?: unknown;
  abono_capital?: unknown;
  abono_interes?: unknown;
  abono_iva_12?: unknown;
  abono_interes_ci?: unknown;
  abono_iva_ci?: unknown;
  abono_seguro?: unknown;
  abono_gps?: unknown;
  membresias_pago?: unknown;
  membresias_mes?: unknown;
  mora?: unknown;
  otros?: unknown;
  pagoConvenio?: unknown;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * ¿El Excel NO tiene registrado el pago de esta cuota?
 *
 * Pasa cuando conta todavía no había anotado el pago al momento de bajar el
 * Excel: la fila existe (matchea por vencimiento) pero viene sin un solo
 * abono. OJO: `cuota`, `membresias` y `total_restante` NO cuentan — esas
 * columnas traen el cargo del mes / saldo proyectado aunque nadie haya pagado.
 */
export function excelSinPagoRegistrado(excel: FilaExcelMontos): boolean {
  return (
    num(excel.abono_capital) === 0 &&
    num(excel.abono_interes) === 0 &&
    num(excel.abono_iva_12) === 0 &&
    num(excel.abono_interes_ci) === 0 &&
    num(excel.abono_iva_ci) === 0 &&
    num(excel.abono_seguro) === 0 &&
    num(excel.abono_gps) === 0 &&
    num(excel.membresias_pago) === 0 &&
    num(excel.pago_del_mes) === 0 &&
    num(excel.mora) === 0 &&
    num(excel.otros) === 0
  );
}

/** ¿El pago de la DB ya tiene plata aplicada (abonos, mora, otros o convenio)? */
export function pagoTieneAplicacion(pago: PagoDbMontos): boolean {
  return [
    pago.monto_aplicado,
    pago.pago_del_mes,
    pago.abono_capital,
    pago.abono_interes,
    pago.abono_iva_12,
    pago.abono_interes_ci,
    pago.abono_iva_ci,
    pago.abono_seguro,
    pago.abono_gps,
    pago.membresias_pago,
    pago.membresias_mes,
    pago.mora,
    pago.otros,
    pago.pagoConvenio,
  ].some((v) => num(v) !== 0);
}

/**
 * Guard anti-borrado: una fila de Excel vacía NO puede escribirse encima de
 * una cuota que en la DB ya tiene pagos aplicados — eso borra plata real.
 *
 * Caso que lo motivó: crédito 967 (SIFCO 01010202102560), cuota 51. El cliente
 * pagó el 2026-07-02 y `/aplicar-pago` abonó Q536.55 a capital; el sync corrió
 * el 2026-07-06 con un Excel que todavía no traía ese pago, y dejó el pago
 * 53941 en `monto_aplicado = 0` con todos los abonos en cero (el capital del
 * crédito y la liquidación del inversionista sí quedaron bien, así que la fila
 * era la única fuente equivocada — justo la que ven la UI y conta).
 */
export function debeProtegerCuota(
  excel: FilaExcelMontos,
  pagos: Array<{ tiene_aplicacion: boolean }>,
): boolean {
  return excelSinPagoRegistrado(excel) && pagos.some((p) => p.tiene_aplicacion);
}
