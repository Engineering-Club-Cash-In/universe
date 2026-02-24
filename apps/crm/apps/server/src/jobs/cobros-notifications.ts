/**
 * Job periódico de notificaciones de cobros
 * - Seguimientos vencidos (proximoContacto pasó sin nuevo contacto)
 * - Casos sin contacto por 3+ días
 */

import { and, eq, lt, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import { createNotification } from "../routers/notifications";

export async function checkSeguimientosVencidos() {
	const now = new Date();

	// Casos con proximoContacto vencido
	const casosVencidos = await db
		.select({
			id: casosCobros.id,
			responsable: casosCobros.responsableCobros,
			proximoContacto: casosCobros.proximoContacto,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
		})
		.from(casosCobros)
		.where(
			and(
				eq(casosCobros.activo, true),
				isNotNull(casosCobros.proximoContacto),
				lt(casosCobros.proximoContacto, now),
			),
		);

	let notificados = 0;

	for (const caso of casosVencidos) {
		// Verificar que no se haya enviado ya una notificación en las últimas 24h
		const yaNotificado = await db
			.select({ id: notifications.id })
			.from(notifications)
			.where(
				and(
					eq(notifications.relatedEntityId, caso.id),
					eq(notifications.relatedEntityType, "collection_case"),
					sql`${notifications.titulo} = 'Seguimiento vencido'`,
					sql`${notifications.createdAt} > now() - interval '24 hours'`,
				),
			)
			.limit(1);

		if (yaNotificado.length === 0) {
			await createNotification({
				titulo: "Seguimiento vencido",
				descripcion: `El seguimiento del caso ${caso.numeroCreditoSifco || caso.id.slice(0, 8)} venció el ${caso.proximoContacto?.toLocaleDateString("es-GT")}`,
				type: "reminder",
				createdBy: caso.responsable,
				createdByRole: "cobros",
				assignedToRole: "cobros",
				assignedTo: caso.responsable,
				relatedEntityType: "collection_case",
				relatedEntityId: caso.id,
				redirectPage: "cobros_detail",
			});
			notificados++;
		}
	}

	console.log(
		`[CobrosNotifications] Seguimientos vencidos: ${casosVencidos.length} encontrados, ${notificados} notificados`,
	);
}

export async function checkCasosSinContacto(diasLimite = 3) {
	const limite = new Date();
	limite.setDate(limite.getDate() - diasLimite);

	// Casos activos
	const casosActivos = await db
		.select({
			id: casosCobros.id,
			responsable: casosCobros.responsableCobros,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
		})
		.from(casosCobros)
		.where(eq(casosCobros.activo, true));

	let notificados = 0;

	for (const caso of casosActivos) {
		// Buscar último contacto
		const ultimoContacto = await db
			.select({ fecha: contactosCobros.fechaContacto })
			.from(contactosCobros)
			.where(eq(contactosCobros.casoCobroId, caso.id))
			.orderBy(sql`${contactosCobros.fechaContacto} desc`)
			.limit(1);

		const fechaUltimo = ultimoContacto[0]?.fecha;
		if (fechaUltimo && fechaUltimo < limite) {
			// Verificar que no se haya notificado en las últimas 24h
			const yaNotificado = await db
				.select({ id: notifications.id })
				.from(notifications)
				.where(
					and(
						eq(notifications.relatedEntityId, caso.id),
						eq(notifications.relatedEntityType, "collection_case"),
						sql`${notifications.titulo} = 'Caso sin contacto reciente'`,
						sql`${notifications.createdAt} > now() - interval '24 hours'`,
					),
				)
				.limit(1);

			if (yaNotificado.length === 0) {
				const dias = Math.floor(
					(Date.now() - fechaUltimo.getTime()) / (1000 * 60 * 60 * 24),
				);
				await createNotification({
					titulo: "Caso sin contacto reciente",
					descripcion: `El caso ${caso.numeroCreditoSifco || caso.id.slice(0, 8)} lleva ${dias} días sin contacto`,
					type: "reminder",
					createdBy: caso.responsable,
					createdByRole: "cobros",
					assignedToRole: "cobros",
					assignedTo: caso.responsable,
					relatedEntityType: "collection_case",
					relatedEntityId: caso.id,
					redirectPage: "cobros_detail",
				});
				notificados++;
			}
		}
	}

	console.log(
		`[CobrosNotifications] Casos sin contacto (>${diasLimite} días): ${notificados} notificados`,
	);
}
