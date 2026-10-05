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
import { usuariosDuenosPorSifco } from "../lib/acceso-caso-cobro";
import {
	armarPendientes,
	filasDelUsuario,
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
	 *
	 * De quién es cada trámite por ejecutar o llamar se decide por quién lleva el
	 * crédito en cartera HOY (`usuariosDuenosPorSifco`), no por a quién se le mandó
	 * el aviso; los rechazos se quedan con quien los pidió. Cartera
	 * puede reasignar el crédito después de la decisión y entonces el aviso sigue
	 * apuntando al dueño anterior (que ya no puede ejecutar) mientras el nuevo no
	 * vería nada. Las filas candidatas salen de tablas locales; si cartera no
	 * responde, cada una cae a su destinatario original (el comportamiento de los
	 * avisos), así que Mi día no falla por cartera.
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
				// Respaldo si no se sabe quién lleva el crédito hoy: el destinatario
				// del aviso, o quien pidió el trámite si no hay aviso.
				destinatario: sql<
					string | null
				>`COALESCE(${notifications.assignedTo}, ${inmovilizacionesUnidad.solicitadoPor})`,
			};

			// Aprobadas y rechazadas recientes. El aviso de decisión solo aporta el
			// destinatario de respaldo (LEFT JOIN: si el aviso no se creó o se
			// descartó, el trámite no deja de existir).
			const decididas = await db
				.select(base)
				.from(inmovilizacionesUnidad)
				.leftJoin(
					notifications,
					and(
						eq(notifications.inmovilizacionId, inmovilizacionesUnidad.id),
						eq(notifications.cobrosTipo, "inmovilizacion_resuelta"),
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
			// con `llamada_contacto_id IS NULL`. El aviso aporta el destinatario de
			// respaldo (de quién es hoy se resuelve abajo, como en las decididas).
			const llamadas = await db
				.select(base)
				.from(inmovilizacionesUnidad)
				.innerJoin(
					notifications,
					and(
						eq(notifications.inmovilizacionId, inmovilizacionesUnidad.id),
						eq(notifications.cobrosTipo, "inmovilizacion_llamar_cliente"),
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

			const candidatas = [...decididas, ...llamadas];
			if (candidatas.length === 0) return { pendientes: [] };

			// Los rechazos no dependen del dueño actual (se quedan con quien los
			// pidió): no hace falta consultar cartera por ellos.
			const duenos = await usuariosDuenosPorSifco(
				candidatas
					.filter((f) => f.estado !== "rechazada")
					.map((f) => f.numeroCreditoSifco),
			);
			const pendientes = armarPendientes(
				filasDelUsuario(decididas, duenos, userId),
				filasDelUsuario(llamadas, duenos, userId),
			);
			return { pendientes };
		},
	),
};
