/**
 * CB-030 — predicado ÚNICO de "promesa de pago vigente".
 *
 * Existía triplicado con tres definiciones distintas (routers/cobros.ts
 * promesaActivaDelCaso, el listado de getTodosLosCreditos, y el job de
 * reconciliación), y las tres discrepaban en dos ejes: si `incumplida`
 * cuenta como vigente, y si se filtra por fecha. La divergencia no rompía el
 * freeze —cartera-back filtra `fecha_promesa >= hoy` del lado del read
 * (cuotaCubiertaPorPromesa en latefee.ts)— pero sí dejaba dos defectos
 * visibles:
 *
 *  - el espejo acumulaba filas `activa=true` de promesas incumplidas de
 *    meses atrás, empujadas de nuevo en cada corrida del job;
 *  - el listado mostraba el badge "Promesa activa" para siempre en esos
 *    mismos casos.
 *
 * Definición canónica: promesa_pago + con fecha + todavía NO vencida
 * (fecha >= medianoche GT de hoy) + estado pendiente o NULL (legacy).
 *
 * `incumplida` NO es vigente: una promesa incumplida ya fracasó, y su fecha
 * necesariamente pasó. `cumplida` tampoco, obviamente — es terminal.
 */

import { and, eq, gte, isNull, or, type SQL } from "drizzle-orm";
import { contactosCobros } from "../db/schema/cobros";
import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";

/** Medianoche GT de hoy — el corte de "todavía no venció". */
export function inicioDelDiaGT(ahora: Date = new Date()): Date {
	return gtDateStrToDate(toDateStrGT(ahora));
}

/**
 * Condiciones drizzle de "promesa vigente", para componer dentro de un
 * `and(...)` mayor (el caller agrega sus propios filtros: por caso, por
 * lote de casos, etc.).
 */
export function condicionesPromesaVigente(ahora: Date = new Date()): SQL[] {
	return [
		eq(contactosCobros.estadoContacto, "promesa_pago"),
		gte(contactosCobros.fechaProximoContacto, inicioDelDiaGT(ahora)),
		// gte ya descarta las filas con fecha NULL, así que no hace falta un
		// isNotNull aparte.
		or(
			eq(contactosCobros.estadoPromesa, "pendiente"),
			isNull(contactosCobros.estadoPromesa),
		) as SQL,
	];
}

/** Igual que arriba pero ya combinado, para usar directo como `where`. */
export function esPromesaVigente(ahora: Date = new Date()): SQL {
	return and(...condicionesPromesaVigente(ahora)) as SQL;
}
