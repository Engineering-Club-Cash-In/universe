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
  cuotaConvenio: number,
  /**
   * Cobros adicionales (rubros) que la boleta va a pagar. Opcional y con cero
   * por defecto para no obligar a los llamadores que no los tienen.
   *
   * Se descuenta acá porque la cascada del backend es otros → mora → RUBROS →
   * convenio → cuotas: cuando le toca al convenio, los rubros ya se cobraron.
   * Sin restarlos, la proyección da de más y el umbral de excedente del
   * formulario queda inflado — una boleta de Q1,000 con Q800 de rubros y un
   * convenio de Q500 proyectaba Q500 cuando al convenio sólo le quedaban Q200,
   * y esos Q300 de diferencia hacían que la boleta pasara sin ofrecerle al
   * asesor las opciones de excedente que le correspondían.
   */
  rubros: number = 0
): number {
  const disponibleTrasDescuentos = montoDisponible - otros - mora - rubros;
  return Math.min(cuotaConvenio, Math.max(0, disponibleTrasDescuentos));
}
