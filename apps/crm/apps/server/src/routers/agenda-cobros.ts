import { and, asc, desc, eq, gte, lt, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	agendaCobrosSnapshotItems,
	agendaCobrosSnapshots,
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import {
	cerrarItemsAgenda,
	type MotivoAgenda,
	ventanaDiaGuatemala,
} from "../lib/agenda-cobros-snapshot";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function resolverFecha(fecha?: string): Promise<string | null> {
	if (fecha) return fecha;
	const [ultima] = await db
		.select({ fecha: max(agendaCobrosSnapshots.fechaGt) })
		.from(agendaCobrosSnapshots)
		.where(eq(agendaCobrosSnapshots.estado, "cerrado"));
	return ultima?.fecha ?? null;
}

export const agendaCobrosRouter = {
	getMiAgendaHoy: cobrosProcedure.handler(async ({ context }) => {
		const asesorId = context.session?.user?.id;
		if (!asesorId) return { fecha: toDateStrGT(new Date()), items: [] };
		const fecha = toDateStrGT(new Date());
		const items = await db
			.select({
				id: agendaCobrosSnapshotItems.id,
				numeroCreditoSifco: agendaCobrosSnapshotItems.numeroCreditoSifco,
				casoCobroId: agendaCobrosSnapshotItems.casoCobroId,
				motivoAgenda: agendaCobrosSnapshotItems.motivoAgenda,
				bucketSnapshot: agendaCobrosSnapshotItems.bucketSnapshot,
				clienteNombre: clients.contactPerson,
				promesaCumplida: agendaCobrosSnapshotItems.promesaCumplida,
				promesaCumplidaEn: agendaCobrosSnapshotItems.promesaCumplidaEn,
			})
			.from(agendaCobrosSnapshotItems)
			.innerJoin(
				agendaCobrosSnapshots,
				eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
			)
			.leftJoin(
				casosCobros,
				eq(agendaCobrosSnapshotItems.casoCobroId, casosCobros.id),
			)
			.leftJoin(
				contratosFinanciamiento,
				eq(casosCobros.contratoId, contratosFinanciamiento.id),
			)
			.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
			.where(
				and(
					eq(agendaCobrosSnapshots.fechaGt, fecha),
					eq(agendaCobrosSnapshots.asesorId, asesorId),
				),
			);
		if (items.length === 0) return { fecha, items: [] };

		// Ventana de fecha empujada al SQL (no en JS): con miles de contactos
		// históricos por caso, traer todo y filtrar en memoria no escala.
		const { desde, hasta } = ventanaDiaGuatemala(fecha);
		// numeroCreditoSifco del caso: mismo fallback de matching que usa el
		// cierre nocturno (contactoPerteneceAlItem) — un item con
		// casoCobroId=null (sin caso CRM vinculado) solo puede matchear por
		// SIFCO, nunca por caso.
		const contactos = await db
			.select({
				id: contactosCobros.id,
				casoCobroId: contactosCobros.casoCobroId,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				realizadoPor: contactosCobros.realizadoPor,
				fechaContacto: contactosCobros.fechaContacto,
				estadoContacto: contactosCobros.estadoContacto,
				comentarios: contactosCobros.comentarios,
			})
			.from(contactosCobros)
			.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
			.where(
				and(
					eq(contactosCobros.realizadoPor, asesorId),
					gte(contactosCobros.fechaContacto, desde),
					lt(contactosCobros.fechaContacto, hasta),
				),
			);

		const cerrados = cerrarItemsAgenda(
			fecha,
			items.map((item) => ({
				asesorId,
				asesorNombre: "",
				numeroCreditoSifco: item.numeroCreditoSifco,
				casoCobroId: item.casoCobroId,
				bucketSnapshot: item.bucketSnapshot,
				motivoAgenda: item.motivoAgenda as MotivoAgenda,
			})),
			contactos,
		);
		const cerradoPorSifco = new Map(
			cerrados.map((c) => [c.numeroCreditoSifco, c]),
		);

		return {
			fecha,
			items: items.map((item) => {
				const cerrado = cerradoPorSifco.get(item.numeroCreditoSifco);
				return {
					...item,
					atendido: cerrado?.atendido ?? false,
					atendidoEn: cerrado?.atendidoEn ?? null,
					resultadoContacto: cerrado?.resultadoContacto ?? null,
					contactoCobroId: cerrado?.contactoCobroId ?? null,
				};
			}),
		};
	}),
	getCumplimientoAgendaResumen: cobrosSupervisorProcedure
		.input(
			z.object({
				fecha: fechaSchema.optional(),
				asesorId: z.string().min(1).optional(),
			}),
		)
		.handler(async ({ input }) => {
			const fecha = await resolverFecha(input.fecha);
			if (!fecha) return { fecha: null, items: [] };
			const where = input.asesorId
				? and(
						eq(agendaCobrosSnapshots.fechaGt, fecha),
						eq(agendaCobrosSnapshots.asesorId, input.asesorId),
						eq(agendaCobrosSnapshots.estado, "cerrado"),
					)
				: and(
						eq(agendaCobrosSnapshots.fechaGt, fecha),
						eq(agendaCobrosSnapshots.estado, "cerrado"),
					);
			const filas = await db
				.select({
					snapshotId: agendaCobrosSnapshots.id,
					asesorId: agendaCobrosSnapshots.asesorId,
					asesorNombre: user.name,
					planificados: agendaCobrosSnapshots.totalPlanificado,
					atendidos: agendaCobrosSnapshots.totalAtendidos,
					pendientes: agendaCobrosSnapshots.totalPendientes,
					estado: agendaCobrosSnapshots.estado,
					capturadoEn: agendaCobrosSnapshots.capturadoEn,
					cerradoEn: agendaCobrosSnapshots.cerradoEn,
				})
				.from(agendaCobrosSnapshots)
				.innerJoin(user, eq(agendaCobrosSnapshots.asesorId, user.id))
				.where(where)
				.orderBy(asc(user.name));

			return {
				fecha,
				items: filas.map((fila) => ({
					...fila,
					porcentaje:
						fila.planificados === 0
							? 0
							: Math.round((fila.atendidos / fila.planificados) * 10_000) / 100,
				})),
			};
		}),

	getCumplimientoAgendaDetalle: cobrosSupervisorProcedure
		.input(
			z.object({
				fecha: fechaSchema,
				asesorId: z.string().min(1),
			}),
		)
		.handler(async ({ input }) => {
			const items = await db
				.select({
					id: agendaCobrosSnapshotItems.id,
					numeroCreditoSifco: agendaCobrosSnapshotItems.numeroCreditoSifco,
					casoCobroId: agendaCobrosSnapshotItems.casoCobroId,
					clienteNombre: clients.contactPerson,
					bucketSnapshot: agendaCobrosSnapshotItems.bucketSnapshot,
					motivoAgenda: agendaCobrosSnapshotItems.motivoAgenda,
					atendido: agendaCobrosSnapshotItems.atendido,
					contactoCobroId: agendaCobrosSnapshotItems.contactoCobroId,
					atendidoEn: agendaCobrosSnapshotItems.atendidoEn,
					resultadoContacto: agendaCobrosSnapshotItems.resultadoContacto,
					realizadoPor: agendaCobrosSnapshotItems.realizadoPor,
					promesaCumplida: agendaCobrosSnapshotItems.promesaCumplida,
					promesaContactoCobroId:
						agendaCobrosSnapshotItems.promesaContactoCobroId,
					promesaCumplidaEn: agendaCobrosSnapshotItems.promesaCumplidaEn,
					metodoContacto: contactosCobros.metodoContacto,
					comentarios: contactosCobros.comentarios,
				})
				.from(agendaCobrosSnapshotItems)
				.innerJoin(
					agendaCobrosSnapshots,
					eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
				)
				.leftJoin(
					casosCobros,
					eq(agendaCobrosSnapshotItems.casoCobroId, casosCobros.id),
				)
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(
					contactosCobros,
					eq(agendaCobrosSnapshotItems.contactoCobroId, contactosCobros.id),
				)
				.where(
					and(
						eq(agendaCobrosSnapshots.fechaGt, input.fecha),
						eq(agendaCobrosSnapshots.asesorId, input.asesorId),
						eq(agendaCobrosSnapshots.estado, "cerrado"),
					),
				)
				.orderBy(
					asc(agendaCobrosSnapshotItems.atendido),
					desc(agendaCobrosSnapshotItems.motivoAgenda),
					asc(agendaCobrosSnapshotItems.numeroCreditoSifco),
				);

			return {
				fecha: input.fecha,
				asesorId: input.asesorId,
				items: items.map((item) => ({ ...item, pendiente: !item.atendido })),
			};
		}),
};
