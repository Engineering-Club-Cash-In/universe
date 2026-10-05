/**
 * "Mis pendientes" de apagado/reactivación en un router aparte: el tipo de los
 * routers de cobros está en el límite donde TS7056 trunca lo inferido en el web.
 * Ver https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { notifications } from "../db/schema/notifications";
import {
	armarPendientes,
	type PendienteInmovilizacion,
} from "../lib/mis-pendientes-inmovilizacion";
import { cobrosProcedure } from "../lib/orpc";

const ESTADOS_ABIERTOS = ["pending", "read", "in_progress"] as const;

// Cuánto tiempo sigue visible en Mi día un apagado/reactivación rechazado.
const DIAS_RECHAZADA_VISIBLE = 7;

export const misPendientesInmovilizacionRouter = {
	/**
	 * Pendientes de apagado/reactivación del asesor, para Mi día: aprobadas que
	 * faltan por ejecutar, llamadas al cliente pendientes y rechazadas recientes.
	 * Lee solo tablas locales: el destinatario de cada trámite es quien recibió el
	 * aviso (el dueño en cartera, con la reconciliación de `inmovilizacion-notif`),
	 * así que no depende de cartera-back.
	 */
	getMisPendientesInmovilizacion: cobrosProcedure.handler(
		async ({ context }): Promise<{ pendientes: PendienteInmovilizacion[] }> => {
			const userId = context.session?.user?.id;
			if (!userId) return { pendientes: [] };

			const base = {
				inmovilizacionId: inmovilizacionesUnidad.id,
				casoId: inmovilizacionesUnidad.casoCobroId,
				numeroCreditoSifco: inmovilizacionesUnidad.numeroCreditoSifco,
				accion: inmovilizacionesUnidad.accion,
				estado: inmovilizacionesUnidad.estado,
				decididoAt: inmovilizacionesUnidad.decididoAt,
				ejecutadoAt: inmovilizacionesUnidad.ejecutadoAt,
			};

			// Aprobadas y rechazadas: el aviso de decisión se le asignó a este
			// usuario (aunque lo haya descartado, el trámite sigue siendo suyo).
			const decididas = await db
				.select(base)
				.from(inmovilizacionesUnidad)
				.innerJoin(
					notifications,
					and(
						eq(notifications.inmovilizacionId, inmovilizacionesUnidad.id),
						eq(notifications.cobrosTipo, "inmovilizacion_resuelta"),
						eq(notifications.assignedTo, userId),
					),
				)
				.innerJoin(
					casosCobros,
					eq(casosCobros.id, inmovilizacionesUnidad.casoCobroId),
				)
				.where(
					and(
						eq(casosCobros.activo, true),
						sql`(${inmovilizacionesUnidad.estado} = 'aprobada' OR (
						${inmovilizacionesUnidad.estado} = 'rechazada'
						AND ${inmovilizacionesUnidad.decididoAt} > now() - make_interval(days => ${DIAS_RECHAZADA_VISIBLE})
						AND NOT EXISTS (
							SELECT 1 FROM inmovilizaciones_unidad o
							WHERE o.caso_cobro_id = ${inmovilizacionesUnidad.casoCobroId}
							AND o.created_at > ${inmovilizacionesUnidad.createdAt}
						)
					))`,
					),
				)
				.orderBy(asc(inmovilizacionesUnidad.decididoAt));

			// Llamadas: el aviso "llamar al cliente" abierto es la tarea. Se mira el
			// estado del aviso a propósito: ese tipo no se puede resolver ni reabrir a
			// mano (COBROS_TIPO_RESOLUCION_BLOQUEADA en routers/notifications.ts), solo
			// el sistema lo cierra al registrar la llamada, así que "abierto" coincide
			// con `llamada_contacto_id IS NULL`. El join también dice de QUIÉN es.
			const llamadas = await db
				.select(base)
				.from(inmovilizacionesUnidad)
				.innerJoin(
					notifications,
					and(
						eq(notifications.inmovilizacionId, inmovilizacionesUnidad.id),
						eq(notifications.cobrosTipo, "inmovilizacion_llamar_cliente"),
						eq(notifications.assignedTo, userId),
						inArray(notifications.status, [...ESTADOS_ABIERTOS]),
					),
				)
				.innerJoin(
					casosCobros,
					eq(casosCobros.id, inmovilizacionesUnidad.casoCobroId),
				)
				.where(
					and(
						eq(casosCobros.activo, true),
						eq(inmovilizacionesUnidad.estado, "ejecutada"),
						isNull(inmovilizacionesUnidad.llamadaContactoId),
					),
				)
				.orderBy(asc(inmovilizacionesUnidad.ejecutadoAt));

			const pendientes = armarPendientes(decididas, llamadas);
			return { pendientes };
		},
	),
};
