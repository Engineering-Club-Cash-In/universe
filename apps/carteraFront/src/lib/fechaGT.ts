/**
 * Fechas de Guatemala.
 *
 * Varias columnas `timestamp` de cartera (`moras_historial.fecha`,
 * `moras_condonaciones.fecha`, …) son SIN zona horaria y guardan el instante en
 * UTC. El backend las serializa como string desnudo —"2026-09-09 05:59:05.245566",
 * sin `Z` ni offset— y `new Date(...)` en el navegador lo interpreta como hora
 * LOCAL: el cron de las 23:59 de Guatemala se veía como "09/09 05:59 a.m.",
 * corrido 6 horas y un día adelante.
 *
 * El criterio del proyecto ya está fijado en SQL
 * (`moraSnapshotSql.ts`: `fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala'`):
 * lo guardado es UTC y se presenta en America/Guatemala. Este módulo es la
 * misma regla del lado del front.
 *
 * ⚠️ Mostrar y filtrar tienen que usar la MISMA zona: si `fmtFechaHoraGT` pinta
 * el día de Guatemala pero el filtro compara contra el día local del navegador,
 * el filtro deja fuera eventos que el usuario sí está viendo.
 */

export const ZONA_GT = "America/Guatemala";

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
/** `Z`, `+00`, `-06:00`… al final del string. */
const TIENE_ZONA = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Normaliza cualquiera de las formas que llegan del backend a un instante.
 * Devuelve null si no hay dato o no parsea (nunca lanza).
 */
export function aInstante(valor: unknown): Date | null {
  if (valor == null || valor === "") return null;

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }

  if (typeof valor === "number") {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof valor !== "string") return null;

  const s = valor.trim();
  if (!s) return null;

  // "2026-09-09" no trae hora: no hay nada que convertir. Lo anclamos al
  // mediodía UTC para que ninguna zona lo corra de día.
  if (SOLO_FECHA.test(s)) {
    const d = new Date(`${s}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(normalizarZona(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

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

/** Fallback cuando el valor no parsea: mostramos lo que vino, sin inventar. */
const crudo = (valor: unknown, vacio: string) =>
  typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 10) : vacio;

/** Fecha + hora en America/Guatemala, ej. "08/09/2026, 23:59". */
export function fmtFechaHoraGT(valor: unknown, vacio = "--"): string {
  const d = aInstante(valor);
  if (!d) return crudo(valor, vacio);
  return d.toLocaleString("es-GT", {
    timeZone: ZONA_GT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Solo la fecha en America/Guatemala, ej. "08/09/2026". */
export function fmtFechaGT(valor: unknown, vacio = "--"): string {
  const d = aInstante(valor);
  if (!d) return crudo(valor, vacio);
  return d.toLocaleDateString("es-GT", {
    timeZone: ZONA_GT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const PARTES_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_GT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Día `YYYY-MM-DD` del evento EN HORA DE GUATEMALA, para comparar contra los
 * `<input type="date">` de los filtros (que el usuario llena pensando en el día
 * que ve en pantalla).
 */
export function diaISOGT(valor: unknown): string {
  const d = aInstante(valor);
  if (!d) return typeof valor === "string" ? valor.trim().slice(0, 10) : "";
  const p = PARTES_DIA.formatToParts(d).reduce<Record<string, string>>(
    (acc, { type, value }) => {
      acc[type] = value;
      return acc;
    },
    {}
  );
  return `${p.year}-${p.month}-${p.day}`;
}
