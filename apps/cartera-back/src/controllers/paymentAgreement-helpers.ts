// Helpers puros de convenios de pago, SIN imports de DB — separado a
// propósito de paymentAgreement.ts para que se pueda testear sin arrastrar
// database/index.ts (que lanza en import-time si SUPABASE_DB_URL no está
// configurado, tronando cualquier test que solo necesite lógica pura).

/**
 * % de avance de un convenio (monto_pagado / monto_total_convenio * 100),
 * como string con 2 decimales para consistencia con el resto de campos
 * numéricos que cartera-back expone como string (evita drift de
 * precisión flotante en el JSON de la API). "0.00" si el total es 0/negativo
 * — nunca divide por cero.
 */
export function calcularProgresoConvenio(
  montoTotalConvenio: string | number,
  montoPagado: string | number
): string {
  const total = Number(montoTotalConvenio) || 0;
  const pagado = Number(montoPagado) || 0;
  if (total <= 0) return "0.00";
  return ((pagado / total) * 100).toFixed(2);
}
