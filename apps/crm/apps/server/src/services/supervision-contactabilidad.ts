/**
 * Mi equipo · contactabilidad en lote (tarea M7 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md).
 *
 * Reemplaza las N llamadas a `getHistorialAgendasResumen` (una por asesor) de
 * las tarjetas de Mi equipo por una sola consulta agrupada por asesor. Usa el
 * MISMO filtro y la MISMA definición de «efectivo» que el resumen, así las
 * cifras cuadran con las del Detalle del asesor y con el Dashboard.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { esContactoEfectivo, whereHistorial } from "../lib/historial-agendas";
import type { USER_ROLE_VALUES } from "../lib/roles";
import {
	type ContactabilidadAsesor,
	rellenarContactabilidad,
} from "../lib/supervision-kpis";

export interface FiltroContactabilidad {
	/** Día calendario de Guatemala (YYYY-MM-DD), inclusive. */
	desde?: string;
	/** Día calendario de Guatemala (YYYY-MM-DD), inclusive. */
	hasta?: string;
	/** Usuarios del CRM a medir; sin esto, todos los que tengan gestiones. */
	usuarioIds?: string[];
	/** Roles a incluir (Mi equipo pasa solo `cobros`). */
	roles?: (typeof USER_ROLE_VALUES)[number][];
}

export async function contactabilidadPorAsesor(
	filtro: FiltroContactabilidad,
	ahora: Date = new Date(),
): Promise<ContactabilidadAsesor[]> {
	// Solo lo llama el supervisor: ve a todo el equipo (sin scoping por usuario).
	const { where } = whereHistorial(
		{
			desde: filtro.desde,
			hasta: filtro.hasta,
			usuarioIds: filtro.usuarioIds,
		},
		{ userId: "", puedeVerTodos: true },
		ahora,
	);
	const condiciones = and(
		where,
		filtro.roles?.length ? inArray(user.role, filtro.roles) : undefined,
		// El link de pago se lista como actividad pero no es contacto del asesor
		// (igual que en getHistorialAgendasResumen).
		ne(contactosCobros.estadoContacto, "link_pago_generado"),
	);
	const filas = await db
		.select({
			userId: contactosCobros.realizadoPor,
			total: sql<number>`count(*)::int`,
			efectivos: sql<number>`count(*) FILTER (WHERE ${esContactoEfectivo()})::int`,
		})
		.from(contactosCobros)
		.innerJoin(user, eq(contactosCobros.realizadoPor, user.id))
		.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
		.where(condiciones)
		.groupBy(contactosCobros.realizadoPor);
	return rellenarContactabilidad(
		filas.map((f) => ({
			userId: f.userId,
			efectivos: Number(f.efectivos),
			total: Number(f.total),
		})),
		filtro.usuarioIds,
	);
}
