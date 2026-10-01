/**
 * CB-043 · Catálogo de justificaciones del checklist de recuperación, desde
 * la base (`cobros_checklist_justificaciones`, migración 0074): por qué no se
 * hizo cada paso. Lo usan el formulario (opciones por paso) y el alta de la
 * solicitud (valida la elegida y guarda su etiqueta).
 */
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { cobrosChecklistJustificaciones } from "../db/schema/cobros";
import type {
	CatalogoJustificaciones,
	OpcionJustificacion,
} from "../lib/recuperacion-solicitud";

/** Las razones ACTIVAS de cada paso, en el orden del catálogo. */
export async function leerCatalogoJustificaciones(): Promise<CatalogoJustificaciones> {
	const filas = await db
		.select({
			paso: cobrosChecklistJustificaciones.paso,
			clave: cobrosChecklistJustificaciones.clave,
			etiqueta: cobrosChecklistJustificaciones.etiqueta,
		})
		.from(cobrosChecklistJustificaciones)
		.where(eq(cobrosChecklistJustificaciones.activo, true))
		.orderBy(
			asc(cobrosChecklistJustificaciones.paso),
			asc(cobrosChecklistJustificaciones.orden),
			asc(cobrosChecklistJustificaciones.id),
		);
	const catalogo: Record<string, OpcionJustificacion[]> = {};
	for (const f of filas) {
		const lista = catalogo[f.paso] ?? [];
		lista.push({ clave: f.clave, etiqueta: f.etiqueta });
		catalogo[f.paso] = lista;
	}
	return catalogo;
}
