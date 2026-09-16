/**
 * Días de Guatemala ↔ instantes UTC.
 *
 * Varias columnas `timestamp` SIN zona de cartera (`moras_historial.fecha`,
 * `moras_condonaciones.fecha`, …) guardan el instante en UTC, pero la pantalla
 * —y el usuario— piensan en el día de Guatemala (GMT-6). El criterio del
 * proyecto está fijado en `controllers/moraSnapshotSql.ts`:
 *
 *   (fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date
 *
 * Ese criterio es correcto pero envuelve la columna en una expresión, así que
 * ningún índice sobre `fecha` puede usarse. Para FILTRAR por día conviene la
 * operación inversa: convertir los límites del día de Guatemala a instantes UTC
 * y comparar contra la columna CRUDA (sargable). Este módulo hace esa conversión.
 *
 * El día GT "2026-08-25" corresponde al intervalo UTC
 * [2026-08-25 06:00:00, 2026-08-26 06:00:00), semiabierto a propósito: así
 * entra TODO el día elegido (incluidos los microsegundos de las 23:59:59.9…)
 * sin tener que adivinar cuál es "el último instante".
 */

export const ZONA_GT = "America/Guatemala";

/** `YYYY-MM-DD`. */
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Años aceptados. Abajo: nada anterior a 1900 es un dato real de cartera y
 * además `Date.UTC` mapea los años de dos dígitos ahí ("0026" → 1926).
 * Arriba: 9998 para que sumarle un día al "hasta" no desborde a 5 dígitos.
 */
const ANIO_MIN = 1900;
const ANIO_MAX = 9998;

const PARTES_GT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_GT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * Componentes de un instante leídos en hora de Guatemala (`year`, `month`,
 * `day`, `hour`, `minute`, `second`), con "24" ya normalizado a "00".
 *
 * Es la única implementación del backend: `excelCashInReport.ts` la importa en
 * lugar de armar su propio `Intl.DateTimeFormat`.
 */
export function partesGT(instante: Date): Record<string, string> {
  const p: Record<string, string> = {};
  for (const { type, value } of PARTES_GT.formatToParts(instante)) {
    p[type] = value;
  }
  // "24" es medianoche en algunos runtimes con hour12:false.
  if (p.hour === "24") p.hour = "00";
  return p;
}

/**
 * Minutos de desfase de Guatemala respecto a UTC en ese instante (hoy siempre
 * -360). Se lee de la base de datos de zonas del runtime en lugar de
 * hardcodear -6: si Guatemala volviera a tener horario de verano —lo tuvo en
 * 2006— el cálculo sigue siendo correcto.
 */
function offsetGTMinutos(instante: Date): number {
  const p = partesGT(instante);
  const hora = p.hour;
  const pared = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(hora),
    Number(p.minute),
    Number(p.second)
  );
  // El instante puede traer milisegundos y `pared` no: se truncan para que la
  // resta dé minutos exactos.
  return (pared - Math.floor(instante.getTime() / 1000) * 1000) / 60_000;
}

/**
 * ¿El instante `t` es, leído en hora de Guatemala, la medianoche exacta del día
 * que representa `supuestoUTC` (la misma fecha pero como medianoche UTC)?
 */
function esMedianocheGTDe(t: number, supuestoUTC: number): boolean {
  if (!Number.isFinite(t)) return false;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return false;
  const p = partesGT(d);
  const objetivo = new Date(supuestoUTC);
  return (
    Number(p.year) === objetivo.getUTCFullYear() &&
    Number(p.month) === objetivo.getUTCMonth() + 1 &&
    Number(p.day) === objetivo.getUTCDate() &&
    p.hour === "00" &&
    p.minute === "00" &&
    p.second === "00"
  );
}

/**
 * Instante UTC de la medianoche (00:00:00.000 hora de Guatemala) del día
 * `diaISO` desplazado `offsetDias` días.
 *
 * Devuelve null si `diaISO` no es un `YYYY-MM-DD` válido: los filtros de fecha
 * llegan de un query string y no deben tumbar el endpoint.
 */
export function inicioDiaGT(diaISO: string, offsetDias = 0): Date | null {
  const m = DIA_ISO.exec(String(diaISO ?? "").trim());
  if (!m) return null;

  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);

  // Rango de años soportado. El tope no es 9999 a propósito: `hastaExclusivo`
  // suma un día y "9999-12-31" caería en el año 10000, que `toISOString()`
  // escribe en formato extendido ("+010000-01-01T…") y Postgres no acepta.
  if (anio < ANIO_MIN || anio > ANIO_MAX) return null;

  // Verificación de ida y vuelta. `Date.UTC` NORMALIZA en silencio lo
  // imposible ("2026-02-31" → 3 de marzo, "2026-13-01" → enero de 2027,
  // "2026-00-10" → diciembre de 2025) y además mapea los años 0-99 a 1900+y
  // ("0026-01-01" → 1926), así que `Number.isNaN` jamás se dispara. Se
  // reconstruyen año/mes/día desde el resultado y se comparan contra lo que
  // pidió el usuario: si no coinciden, la fecha no existe.
  const base = Date.UTC(anio, mes - 1, dia);
  if (!Number.isFinite(base)) return null;
  const chequeo = new Date(base);
  if (
    chequeo.getUTCFullYear() !== anio ||
    chequeo.getUTCMonth() !== mes - 1 ||
    chequeo.getUTCDate() !== dia
  ) {
    return null;
  }

  const supuesto = base + offsetDias * 86_400_000;
  if (!Number.isFinite(supuesto)) return null;

  // Dos pasadas: la primera usa el offset "en" la medianoche supuesta, la
  // segunda lo recalcula ya sobre el instante corregido (importa solo si la
  // zona cambiara de offset justo esa madrugada).
  const t1 = supuesto - offsetGTMinutos(new Date(supuesto)) * 60_000;
  const t2 = supuesto - offsetGTMinutos(new Date(t1)) * 60_000;

  // Guatemala tuvo horario de verano en 2006, así que hay días cuya medianoche
  // local NO EXISTIÓ: el 2006-04-30 el reloj saltó de las 23:59 del 29 a la
  // 01:00 del 30. En ese hueco las dos pasadas oscilan (una da 06:00Z, la otra
  // 05:00Z) y quedarse con la última devolvía 05:00Z, que en Guatemala es el
  // 29 a las 23:00: el filtro se corría un día entero.
  //
  // Se valida cada candidato releyéndolo en hora de Guatemala:
  //  - si alguno cae exactamente en la medianoche del día pedido, ese es (el
  //    más temprano, para que un día repetido por fin de DST entre completo);
  //  - si ninguno cae —el hueco—, se toma el MÁS TARDÍO, que es justo el
  //    instante de la transición, o sea el primer instante que sí existe de
  //    ese día (01:00 local = 06:00Z para el 2006-04-30).
  const validos = [t1, t2].filter((t) => esMedianocheGTDe(t, supuesto));
  const t = validos.length > 0 ? Math.min(...validos) : Math.max(t1, t2);

  const fecha = new Date(t);
  if (Number.isNaN(fecha.getTime())) return null;
  // El desplazamiento no puede sacarnos del formato de 4 dígitos.
  const anioFinal = fecha.getUTCFullYear();
  if (anioFinal < 1000 || anioFinal > 9999) return null;
  return fecha;
}

/**
 * El mismo instante, ya formateado como literal de `timestamp` SIN zona en UTC
 * ("2026-08-25 06:00:00.000"), que es exactamente lo que guarda la columna.
 *
 * Se compara como parámetro casteado (`$1::timestamp`) y no como Date: los
 * drivers serializan Date con zona y la conversión de vuelta depende del
 * `TimeZone` de la sesión, que en este backend no está garantizado.
 */
export function inicioDiaGTComoTimestampUTC(
  diaISO: string,
  offsetDias = 0
): string | null {
  const d = inicioDiaGT(diaISO, offsetDias);
  if (!d) return null;
  const iso = d.toISOString();
  // `toISOString()` usa el formato extendido ("+010000-…") fuera de [1000, 9999]
  // y el slice de 23 lo cortaría a un literal corrupto. `inicioDiaGT` ya acota
  // el año; esto es la red por si alguien afloja ese límite.
  if (!/^\d{4}-/.test(iso)) return null;
  return iso.slice(0, 23).replace("T", " ");
}

/** `Z`, `+00`, `-06:00`… al final del string. */
const TIENE_ZONA = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;
/** `YYYY-MM-DD` pelado, sin hora. */
export const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Deja el string en algo que `new Date()` entienda:
 * - "2026-09-09 05:59:05" → "2026-09-09T05:59:05Z" (sin zona = UTC).
 * - Postgres escribe el offset con dos dígitos ("+00"); JS exige "+00:00".
 */
function normalizarZona(s: string): string {
  const iso = s.replace(" ", "T");
  if (!TIENE_ZONA.test(iso)) return `${iso}Z`;
  return iso.replace(/([+-]\d{2})$/, "$1:00");
}

/**
 * Normaliza a instante lo que devuelve la BD.
 *
 * Las columnas `timestamp` SIN zona de cartera (`moras_historial.fecha`,
 * `moras_condonaciones.fecha`) guardan UTC y llegan como string desnudo
 * ("2026-09-09 05:59:05.245566"). `new Date(...)` las interpretaría en la zona
 * del servidor, así que si no traen zona se las marcamos como UTC.
 */
export function aInstante(v: any): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== "string") return null;

  const s = v.trim();
  if (!s) return null;

  // Sin hora no hay nada que convertir: se ancla al mediodía UTC para que
  // ninguna zona lo corra de día.
  if (SOLO_FECHA.test(s)) {
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(normalizarZona(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Antes vivía aquí `rangoDiasGTenUTC(desde, hasta)`. Se eliminó al arreglar el
// filtro de condonaciones: devolvía null tanto para "no me mandaron fecha" como
// para "la fecha es basura", y quien llamaba no podía distinguirlos (terminaba
// devolviendo TODA la historia con HTTP 200). Ahora el llamador convierte cada
// límite con `inicioDiaGTComoTimestampUTC` y decide qué hacer con el null.
