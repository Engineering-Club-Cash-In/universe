import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { normalizarCorreo } from "../utils/email-normalization";

export { normalizarCorreo };

/**
 * Compara un correo contra una columna ignorando mayúsculas y espacios de los
 * extremos.
 *
 * Es el gemelo de `eqDpi` para la otra llave con la que el portal resuelve
 * identidad. El registro (`decidirLeadDelPortal`) ya normaliza los dos correos
 * antes de compararlos, así que una cuenta creada como "Ana@Ejemplo.com" se da
 * de alta contra el lead "ana@ejemplo.com" sin problema; si la búsqueda en base
 * compara con `=` exacto, esa misma cuenta deja de encontrar su ficha en cuanto
 * termina el registro. Normalizar en memoria y comparar exacto en la consulta
 * es la asimetría que hay que evitar.
 *
 * `lower(...) = ...` y no `ilike`: en un `LIKE` los `_` y `%` del correo se
 * leerían como comodines aunque el valor viaje parametrizado, y un correo puede
 * llevarlos. Se compara, no se busca por patrón.
 *
 * OJO: esto no usa índice sobre `email`. Si alguna vez pesa, la solución es un
 * índice funcional `lower(btrim(email))`, no volver al `=` exacto.
 */
export function eqEmail(column: AnyPgColumn, email: string): SQL {
	return sql`lower(btrim(${column})) = ${normalizarCorreo(email)}`;
}
