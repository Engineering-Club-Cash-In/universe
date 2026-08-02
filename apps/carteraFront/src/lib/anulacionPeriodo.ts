// 🗓️ Espejo en el front de la validación de período que hace el back al anular
// facturas (apps/cartera-back/src/routers/cofidi.ts → POST /api/dte/anular).
//
// Regla: se puede anular una factura del período (mes) actual, y también una del
// período inmediatamente anterior mientras estemos dentro de los primeros
// DIAS_GRACIA_ANULACION días del mes. Contabilidad confirmó que SAT da esos días
// de gracia; antes cortábamos el día 1 a las 00:00 y una factura de fin de mes se
// quedaba sin ventana real para corregirse.
//
// Esto solo sirve para AVISAR en la UI. La validación real vive en el back, y la
// última palabra la tiene SAT: puede rechazar la anulación aunque estemos dentro
// de la gracia, o aceptarla y no reflejarla — por eso hay que verificar en el portal.

export const DIAS_GRACIA_ANULACION = 5;

/**
 * ¿La anulación de esta factura cae en los días de gracia del período anterior?
 * Devuelve false para facturas del mes actual (anulación normal) y para las de
 * períodos ya cerrados (el back las rechaza con PERIODO_DECLARACION_CERRADO).
 */
export function esAnulacionEnDiasDeGracia(
  fechaFactura?: string | Date | null,
  hoy: Date = new Date()
): boolean {
  if (!fechaFactura) return false;

  const fecha = fechaFactura instanceof Date ? fechaFactura : new Date(fechaFactura);
  if (isNaN(fecha.getTime())) return false;

  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  // Mismo período = anulación normal, sin aviso
  if (fecha.getFullYear() === anioActual && fecha.getMonth() === mesActual) return false;

  // Período inmediatamente anterior (con salto de año diciembre → enero)
  const mesAnterior = mesActual === 0 ? 11 : mesActual - 1;
  const anioDelMesAnterior = mesActual === 0 ? anioActual - 1 : anioActual;
  const esPeriodoAnterior =
    fecha.getFullYear() === anioDelMesAnterior && fecha.getMonth() === mesAnterior;

  return esPeriodoAnterior && hoy.getDate() <= DIAS_GRACIA_ANULACION;
}

/** Fecha que manda para decidir el período: la de certificación, si no la de emisión. */
export function fechaPeriodoFactura(factura?: {
  fecha_certificacion?: string | null;
  fecha_emision?: string | null;
} | null): string | null {
  if (!factura) return null;
  return factura.fecha_certificacion || factura.fecha_emision || null;
}
