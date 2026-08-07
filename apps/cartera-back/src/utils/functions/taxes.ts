import Big from "big.js";

// Tasas del descuento total de impuestos al liquidar (inversionistas con
// descuenta_impuestos = true). Base SIEMPRE el interés bruto.
export const TASA_IVA_DESCUENTO = "0.12";
export const TASA_ISR_DESCUENTO = "0.07";

/** El carril de descuento aplica ÚNICAMENTE con el flag explícito en true. */
export function aplicaDescuentaImpuestos(inv: {
  descuenta_impuestos?: boolean | null;
}): boolean {
  return inv?.descuenta_impuestos === true;
}

/**
 * Desglose del descuento sobre el interés bruto:
 * neto = interés − IVA(12%) − ISR(7%) = interés × 0.81.
 * `ajuste` es el término aditivo (−IVA − ISR) para componer cuotas
 * (capital + interés + ajuste) sin alterar las fórmulas existentes.
 */
export function descuentoImpuestos(interes: Big): {
  iva: Big;
  isr: Big;
  ajuste: Big;
  neto: Big;
} {
  const iva = interes.times(TASA_IVA_DESCUENTO);
  const isr = interes.times(TASA_ISR_DESCUENTO);
  const ajuste = iva.plus(isr).neg();
  return { iva, isr, ajuste, neto: interes.plus(ajuste) };
}
