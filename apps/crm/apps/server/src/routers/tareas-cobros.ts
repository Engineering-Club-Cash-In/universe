/**
 * CB-035 — "Mis tareas" del supervisor de cobros.
 *
 * El supervisor no tiene agenda propia (`/cobros/mi-dia` lo manda a la Cola del
 * día del equipo), así que sus tareas B3 se listan en una sección aparte de esa
 * pantalla. Lee SOLO `notifications` local: no depende de cartera-back, que sí
 * alimenta `getColaDia`. Si cartera cae, la cola falla pero las tareas se ven.
 *
 * Las tareas NO entran a `agenda_cobros_snapshots` ni al % de cumplimiento: ese
 * cálculo mide gestión de créditos del asesor, y una tarea del supervisor no lo
 * es.
 *
 * Archivo aparte por el mismo motivo que `historial-agendas.ts`: `cobrosAppRouter`
 * está en el límite donde TS7056 trunca en silencio el tipo inferido.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	COBROS_TIPOS_TAREA,
	type EstadoPlazoTarea,
	estadoPlazoTarea,
} from "../lib/b3-llamada";
import { cobrosSupervisorProcedure } from "../lib/orpc";

const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

// Vencidas primero, luego las que vencen hoy, luego las que están en plazo.
const ORDEN_PLAZO: Record<EstadoPlazoTarea, number> = {
	vencida: 0,
	vence_hoy: 1,
	en_plazo: 2,
};

export const tareasCobrosRouter = {
	/**
	 * Tareas abiertas asignadas AL USUARIO que consulta. Gate = `canAssignCobros`
	 * (admin + cobros_supervisor), el mismo predicado con que la Cola del día
	 * decide mostrar la sección; las tareas B3 solo se asignan a cobros_supervisor,
	 * así que un admin ve la lista vacía.
	 */
	getMisTareasCobros: cobrosSupervisorProcedure.handler(async ({ context }) => {
		const userId = context.session?.user?.id;
		if (!userId) return { tareas: [] };

		const filas = await db
			.select({
				id: notifications.id,
				casoId: notifications.relatedEntityId,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				cobrosTipo: notifications.cobrosTipo,
				titulo: notifications.titulo,
				descripcion: notifications.descripcion,
				status: notifications.status,
				fechaVencimiento: notifications.fechaVencimiento,
				createdAt: notifications.createdAt,
			})
			.from(notifications)
			.innerJoin(casosCobros, eq(casosCobros.id, notifications.relatedEntityId))
			.where(
				and(
					eq(notifications.assignedTo, userId),
					inArray(notifications.cobrosTipo, [...COBROS_TIPOS_TAREA]),
					inArray(notifications.status, [...ESTADOS_ABIERTOS]),
					eq(casosCobros.activo, true),
				),
			)
			.orderBy(asc(notifications.fechaVencimiento))
			.limit(200);

		const ahora = new Date();
		const tareas = filas
			.map((f) => ({
				...f,
				estadoPlazo: f.fechaVencimiento
					? estadoPlazoTarea(f.fechaVencimiento, ahora)
					: ("en_plazo" as const),
			}))
			.sort(
				(a, b) =>
					ORDEN_PLAZO[a.estadoPlazo] - ORDEN_PLAZO[b.estadoPlazo] ||
					(a.fechaVencimiento?.getTime() ?? Number.MAX_SAFE_INTEGER) -
						(b.fechaVencimiento?.getTime() ?? Number.MAX_SAFE_INTEGER),
			);

		return { tareas };
	}),
};
