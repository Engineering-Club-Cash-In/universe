import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { normalizarDpi } from "../utils/cui-validation";

/**
 * Compara un DPI contra una columna ignorando el formato con el que quedó
 * guardado.
 *
 * Los DPI que entran hoy se normalizan antes de guardarse, pero los que vienen
 * de migraciones y cargas viejas quedaron con espacios ("3460 66638 0101"). Un
 * `eq` directo no reconoce a esos como la misma persona, así que las búsquedas
 * de duplicados los dejaban pasar y se creaban leads repetidos.
 */
export function eqDpi(column: AnyPgColumn, dpi: string): SQL {
	return sql`regexp_replace(${column}, '\\s', '', 'g') = ${normalizarDpi(dpi)}`;
}
