/**
 * Formato de fecha que espera SAT en los XML de anulación: `2026-08-13T11:13:59`
 * — sin milisegundos y sin sufijo de zona. `.toISOString()` NO sirve: produce
 * `2026-08-13T11:13:59.000Z` y SAT rechaza el documento.
 *
 * Se lee con getUTC* a propósito. `fecha_emision` y `fecha_certificacion` se
 * persisten YA en hora de Guatemala, así que con los getters locales se
 * desplazarían según la zona horaria del proceso — que en el contenedor es UTC.
 *
 * Esta función vivía dentro del handler de anulación manual en
 * `routers/cofidi.ts`, donde no era reutilizable: la reversa de pago tenía su
 * propia copia con `.toISOString()` y le mandaba a SAT un formato inválido.
 */
export const formatearFechaSAT = (fecha: Date): string => {
  const year = fecha.getUTCFullYear();
  const month = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const day = String(fecha.getUTCDate()).padStart(2, "0");
  const hours = String(fecha.getUTCHours()).padStart(2, "0");
  const minutes = String(fecha.getUTCMinutes()).padStart(2, "0");
  const seconds = String(fecha.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
};

/**
 * "Ahora" en hora de Guatemala (UTC-6 fijo, sin horario de verano), para
 * `FechaHoraAnulacion`. Con `new Date()` a secas, una anulación de la noche
 * viajaría a SAT con el día siguiente: el contenedor corre en UTC.
 */
export const ahoraEnGuatemala = (): Date => {
  const hoy = new Date();
  hoy.setUTCHours(hoy.getUTCHours() - 6);
  return hoy;
};
