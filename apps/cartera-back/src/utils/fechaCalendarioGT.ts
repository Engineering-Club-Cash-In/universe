// Vive acá y no en `latefee.ts` —donde nació— para que las reglas puras
// (p. ej. `condonacionNexaATiempo.ts`) la usen sin importar la conexión a la
// base. `latefee.ts` la re-exporta para no romper a quien ya la importaba.
/**
 * Fecha de CALENDARIO (año/mes/día) de un vencimiento, como número comparable
 * — `Date.UTC(y, m, d)`, o sea la medianoche UTC de ese día.
 *
 * `cuotas_credito.fecha_vencimiento` es un `timestamp` SIN zona que guarda la
 * fecha de calendario tal cual (siempre 00:00:00); NO es un instante. `pg` la
 * entrega como un Date cuyos campos LOCALES ya son esa fecha, así que se leen
 * tal cual. Pasarla por `toZonedTime` —que sirve para instantes reales, como
 * `moras_historial.fecha`— le resta 6 h y en un proceso UTC (producción: el
 * Dockerfile arranca de oven/bun y no fija TZ) la tira al DÍA ANTERIOR: la
 * cuota cobraría mora el mismo día que vence, y el cron (TS) quedaría peleado
 * con el guard de createMora/paymentAgreement (SQL, que usa
 * `fecha_vencimiento::date` y sí acierta).
 *
 * Con los dos extremos en `Date.UTC(...)` la resta es exacta en múltiplos de
 * 86_400_000: no hay residuos que redondear.
 *
 * El `hoy` que reciben los helpers de abajo es el canónico `hoyGuatemala()`,
 * cuyos campos locales YA son la hora de pared de Guatemala: por eso también
 * se le leen tal cual y no se lo vuelve a pasar por `toZonedTime` (hacerlo lo
 * correría un día más).
 */
export function fechaCalendarioGT(valor: Date | string): number {
  if (typeof valor === "string") {
    // "2026-09-20", "2026-09-20 00:00:00", "2026-09-20T00:00:00.000Z": los
    // primeros 10 caracteres son la fecha. Nunca `new Date(str)`, que
    // reintroduce la zona del proceso.
    // Se valida la FORMA antes de parsear: `Number("")` es 0, así que un string
    // truncado como "2026-09" pasaba el chequeo de Number.isFinite (día 0) y
    // devolvía en silencio el 31-ago-2026. Exigir YYYY-MM-DD en los primeros 10
    // caracteres es lo único que distingue "fecha" de "basura"; lo que venga
    // después ("T00:00:00Z", " 00:00:00") no importa y se ignora igual que antes.
    const fecha = valor.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NaN;
    const anio = Number(fecha.slice(0, 4));
    const mes = Number(fecha.slice(5, 7));
    const dia = Number(fecha.slice(8, 10));
    return Date.UTC(anio, mes - 1, dia);
  }
  return Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate());
}
