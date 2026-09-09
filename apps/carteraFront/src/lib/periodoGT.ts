/**
 * Selección de período (Año / Mes / Día) → par `desde`/`hasta` de DÍAS DE
 * GUATEMALA (`YYYY-MM-DD`), que es lo único que viaja al backend.
 *
 * Vive acá y no dentro del componente porque es la parte que puede producir una
 * fecha que no existe: con "31" elegido en Enero y un cambio a Febrero, el
 * `<select>` de día se dibuja en blanco ("Todo el mes") pero el estado sigue en
 * "31" y se arma `2026-02-31`. Al ser lógica pura se prueba sin montar la
 * pantalla (ver `periodoGT.test.ts`).
 */

import { diaISOGT, fmtFechaGT } from "./fechaGT";

export type ModoFecha = "periodo" | "rango";

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Año en curso EN GUATEMALA (a las 18:00 GT del 31/12 el navegador ya podría estar en enero). */
export const anioActualGT = (): number =>
  Number(diaISOGT(new Date()).slice(0, 4));

export const dosDigitos = (n: number | string): string =>
  String(n).padStart(2, "0");

/**
 * Días que tiene el mes (`mes` 1-12), vía "día 0 del mes siguiente".
 * Contempla bisiestos: febrero de 2024 son 29, el de 2025 son 28.
 */
export const diasDelMes = (anio: number, mes: number): number =>
  new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * Día que debe quedar seleccionado al cambiar de año o de mes.
 *
 * Devuelve el string que va al estado:
 * - "" si no había día elegido, o si el año/mes nuevo dejó de estar completo
 *   (sin año no hay mes ni día que valgan).
 * - el mismo día si todavía cabe en el mes nuevo.
 * - el último día del mes nuevo si se pasa (31 en Enero → 28/29 en Febrero).
 *
 * Recortar en vez de limpiar conserva la intención del usuario: pidió "fin de
 * mes", no "todo el mes".
 */
export function recortarDiaAlMes(
  dia: string,
  anio: string,
  mes: string
): string {
  if (!dia) return "";
  if (!anio || !mes) return "";
  const tope = diasDelMes(Number(anio), Number(mes));
  const n = Number(dia);
  if (!Number.isFinite(n)) return "";
  return n > tope ? String(tope) : dia;
}

/**
 * Traduce la selección de la barra de filtros al par desde/hasta.
 * Sin año, el período no filtra nada.
 */
export function rangoDesdeSeleccion(opts: {
  modo: ModoFecha;
  anio: string;
  mes: string;
  dia: string;
  desde: string;
  hasta: string;
}): { desde: string; hasta: string } {
  if (opts.modo === "rango") {
    return { desde: opts.desde, hasta: opts.hasta };
  }
  if (!opts.anio) return { desde: "", hasta: "" };
  if (!opts.mes) return { desde: `${opts.anio}-01-01`, hasta: `${opts.anio}-12-31` };
  const mes = dosDigitos(opts.mes);
  const ultimo = diasDelMes(Number(opts.anio), Number(opts.mes));
  if (!opts.dia) {
    return {
      desde: `${opts.anio}-${mes}-01`,
      hasta: `${opts.anio}-${mes}-${dosDigitos(ultimo)}`,
    };
  }
  // Último cinturón: aunque el día quedara fuera de rango por cualquier vía,
  // de acá NO puede salir un `2026-02-31`.
  const diaSeguro = Math.min(Math.max(Number(opts.dia), 1), ultimo);
  const dia = `${opts.anio}-${mes}-${dosDigitos(diaSeguro)}`;
  return { desde: dia, hasta: dia };
}

/** "el 25/08/2026", "del 01/08/2026 al 31/08/2026", "desde el …", "hasta el …". */
export function etiquetaRango(desde: string, hasta: string): string {
  if (desde && hasta) {
    return desde === hasta
      ? `el ${fmtFechaGT(desde)}`
      : `del ${fmtFechaGT(desde)} al ${fmtFechaGT(hasta)}`;
  }
  if (desde) return `desde el ${fmtFechaGT(desde)}`;
  if (hasta) return `hasta el ${fmtFechaGT(hasta)}`;
  return "";
}
