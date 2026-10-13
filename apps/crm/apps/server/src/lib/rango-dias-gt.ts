import { and, gte, lt, type SQL, sql } from "drizzle-orm";
import { gtDateStrToDate } from "./guatemala-month-window";

const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * Rango de días calendario de Guatemala (YYYY-MM-DD, ambos inclusivos) como
 * instantes: `desde` es la medianoche GT del primer día y `hastaExcl` la del
 * día siguiente al último, para filtrar `col >= desde AND col < hastaExcl`.
 * Cualquiera de los dos puede faltar (rango abierto).
 */
export function rangoDiasGT(
	desde?: string | null,
	hasta?: string | null,
): { desde: Date | null; hastaExcl: Date | null } {
	return {
		desde: desde ? gtDateStrToDate(desde) : null,
		hastaExcl: hasta
			? new Date(gtDateStrToDate(hasta).getTime() + MS_DIA)
			: null,
	};
}

/**
 * Condición `expresion ∈ [desde, hastaExcl)` para una EXPRESIÓN SQL (un
 * `coalesce(...)`, un `CASE`…) sobre columnas `timestamp` sin zona, que el CRM
 * guarda en UTC.
 *
 * Con una expresión, Drizzle no conoce el tipo y manda el `Date` tal cual: `pg`
 * lo serializa en la hora LOCAL del proceso con su offset, y Postgres descarta el
 * offset al compararlo con un `timestamp`, así que en un servidor que no esté en
 * UTC el rango se corre horas. Aquí el instante viaja como ISO en UTC y con
 * cast explícito. (Con una columna, Drizzle ya lo serializa bien.)
 */
export function enRangoSql(
	expresion: SQL,
	rango: { desde: Date | null; hastaExcl: Date | null },
): SQL | undefined {
	const instante = (d: Date) => sql`${d.toISOString()}::timestamp`;
	return and(
		rango.desde ? gte(expresion, instante(rango.desde)) : undefined,
		rango.hastaExcl ? lt(expresion, instante(rango.hastaExcl)) : undefined,
	);
}
