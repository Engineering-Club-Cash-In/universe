// 🗓️ Espejo en el front de la validación de período que hace el back al anular
// facturas (apps/cartera-back/src/routers/cofidi.ts → POST /api/dte/anular).
//
// Regla: se puede anular una factura del período (mes) actual, y también una del
// período inmediatamente anterior mientras estemos dentro de los primeros
// DIAS_GRACIA_ANULACION días del mes. Contabilidad confirmó que SAT da esos días
// de gracia; antes cortábamos el día 1 a las 00:00 y una factura de fin de mes se
// quedaba sin ventana real para corregirse.
//
// 🌎 Zona horaria: todo se resuelve en hora de Guatemala (UTC-6 fijo, sin horario
// de verano), igual que el back, por dos motivos distintos:
//   - "hoy": para no depender de la zona horaria del navegador de quien lo use.
//   - la fecha de la factura: el back persiste fecha_emision/fecha_certificacion YA
//     en hora Guatemala, pero la API las serializa como si fueran UTC. Se leen con
//     getUTC* para recuperar el valor nominal sin desplazarlo otra vez (si no, una
//     factura certificada 23:30 del último día del mes se vería como del mes
//     siguiente).
//
// Esto solo sirve para AVISAR en la UI. La validación real vive en el back, y la
// última palabra la tiene SAT: puede rechazar la anulación aunque estemos dentro
// de la gracia, por eso hay que verificar en el portal.

export const DIAS_GRACIA_ANULACION = 5;

/** Instante actual desplazado a hora de Guatemala; leer siempre con getUTC*. */
function ahoraEnGuatemala(): Date {
  const ahora = new Date();
  ahora.setUTCHours(ahora.getUTCHours() - 6);
  return ahora;
}

/**
 * ¿La anulación de esta factura cae en los días de gracia del período anterior?
 * Devuelve false para facturas del mes actual (anulación normal) y para las de
 * períodos ya cerrados (el back las rechaza con PERIODO_DECLARACION_CERRADO).
 *
 * @param hoyGT instante actual ya expresado en hora Guatemala (parametrizable
 *              para poder testear los días borde).
 */
export function esAnulacionEnDiasDeGracia(
  fechaFactura?: string | Date | null,
  hoyGT: Date = ahoraEnGuatemala()
): boolean {
  if (!fechaFactura) return false;

  const fecha = fechaFactura instanceof Date ? fechaFactura : new Date(fechaFactura);
  if (isNaN(fecha.getTime())) return false;

  const mesActual = hoyGT.getUTCMonth();
  const anioActual = hoyGT.getUTCFullYear();

  // Mismo período = anulación normal, sin aviso
  if (fecha.getUTCFullYear() === anioActual && fecha.getUTCMonth() === mesActual) return false;

  // Período inmediatamente anterior (con salto de año diciembre → enero)
  const mesAnterior = mesActual === 0 ? 11 : mesActual - 1;
  const anioDelMesAnterior = mesActual === 0 ? anioActual - 1 : anioActual;
  const esPeriodoAnterior =
    fecha.getUTCFullYear() === anioDelMesAnterior && fecha.getUTCMonth() === mesAnterior;

  return esPeriodoAnterior && hoyGT.getUTCDate() <= DIAS_GRACIA_ANULACION;
}

/**
 * Fecha que manda para decidir el período: la de EMISIÓN del DTE (FechaHoraEmision),
 * con la de certificación solo como respaldo.
 *
 * No son intercambiables: al facturar en los primeros días del mes, el back
 * backdatea fecha_emision al último día del mes anterior y deja la certificación en
 * el mes en curso. El período de IVA es el de la emisión.
 */
export function fechaPeriodoFactura(factura?: {
  fecha_certificacion?: string | null;
  fecha_emision?: string | null;
} | null): string | null {
  if (!factura) return null;
  return factura.fecha_emision || factura.fecha_certificacion || null;
}
