/**
 * El backend acepta abonos parciales al convenio (processConvenioPayment aplica
 * lo que llegue y deja la cuota del convenio pendiente hasta completarla), así
 * que al desglosar la boleta solo se descuenta del convenio lo que el monto
 * disponible alcance a cubrir después de otros y mora.
 */
export function getConvenioAplicado(
  montoDisponible: number,
  otros: number,
  mora: number,
  cuotaConvenio: number
): number {
  const disponibleTrasDescuentos = montoDisponible - otros - mora;
  return Math.min(cuotaConvenio, Math.max(0, disponibleTrasDescuentos));
}
