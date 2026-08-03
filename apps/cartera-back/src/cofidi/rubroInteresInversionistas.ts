import Big from "big.js";

Big.DP = 20;
Big.RM = Big.roundHalfUp;

/**
 * Decide si se escribe el rubro INTERES_INVERSIONISTAS del desglose y con qué montos.
 *
 * Por qué existe:
 *   `pagos_credito_inversionistas` (pci) se llena hasta que la cuota se COMPLETA.
 *   En pagos PARCIALES cofidi sí emite los DTEs de la parte de cada inversionista,
 *   pero pci todavía está en 0 → el rubro no se escribía y el snapshot de
 *   Facturación Diaria perdía facturación real ya emitida.
 *
 * Regla híbrida (pci manda cuando existe, la corrida es el fallback):
 *   • !interesFlujoOk               → null (el flujo de interés abortó; no atribuimos nada).
 *   • pciTotal > 0                  → pci tal cual (NO se recalcula IVA: es el reparto real).
 *   • pciTotal = 0 y corridaTotal>0 → lo facturado en ESTA corrida (Σ partes con IVA y
 *                                     Σ IVAs por-inversionista, los mismos que fueron a los DTEs).
 *   • ambos en 0                    → null.
 */
export function decidirRubroInteresInversionistas(args: {
  interesFlujoOk: boolean;
  /** Suma desde pci (no-CUBE, emite_factura=false, sin redirigidos a CUBE). */
  pciTotal: Big;
  pciIva: Big;
  /** Acumulado facturado en esta corrida, mismas reglas de inclusión que pci. */
  corridaTotal: Big;
  corridaIva: Big;
}): { monto_total: string; monto_iva: string } | null {
  const { interesFlujoOk, pciTotal, pciIva, corridaTotal, corridaIva } = args;

  if (!interesFlujoOk) return null;

  if (pciTotal.gt(0)) {
    return { monto_total: pciTotal.toFixed(2), monto_iva: pciIva.toFixed(2) };
  }

  if (corridaTotal.gt(0)) {
    return { monto_total: corridaTotal.toFixed(2), monto_iva: corridaIva.toFixed(2) };
  }

  return null;
}

/**
 * ¿La parte facturada a este inversionista suma al rubro INTERES_INVERSIONISTAS?
 * Misma semántica del filtro de la query de pci: solo no-CUBE que NO se autofacturan
 * y que no fueron redirigidos a CUBE (esos ya viajan dentro del rubro INTERES).
 */
export function cuentaParaRubroInv(
  inv: { nombre: string; emite_factura?: boolean | null },
  redirigirACube: boolean
): boolean {
  const esCube = inv.nombre.trim().toUpperCase().includes("CUBE INVESTMENTS");
  if (esCube) return false;
  if (redirigirACube) return false;
  return inv.emite_factura !== true;
}
