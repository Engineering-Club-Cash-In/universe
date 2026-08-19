import { and, asc, count, desc, eq, gte, inArray, lt, max } from "drizzle-orm";
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
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
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
	/**
	 * Limitación conocida: `promesaCumplida`/`promesaCumplidaEn` (abajo) solo
	 * las escribe `cerrarSnapshotsAgenda` (job de medianoche) — a diferencia
	 * de `atendido` (recalculado en vivo abajo con `cerrarItemsAgenda`, que es
	 * puro y solo lee `contactos_cobros` propio). Un pago que llega DURANTE
	 * el día sigue mostrándose como pendiente en esta vista hasta el cierre
	 * nocturno, porque confirmar el pago requiere evaluarPromesa() contra
	 * cartera-back (llamada de red por SIFCO, ver getEstadoPromesasPago en
	 * routers/cobros.ts) — evaluarlo acá convertiría este endpoint de
	 * solo-DB en uno con N llamadas HTTP en cada carga de "Mi agenda de
	 * hoy". No corrompe métricas del supervisor: el cierre nocturno (que sí
	 * cuenta promesa_cumplida como atendido, ver jobs/agenda-cobros-snapshots.ts)
	 * ya lo resuelve correctamente para el ranking de cumplimiento — este
	 * gap es solo la vista personal del asesor durante el día (Codex PR #1332).
	 */
	getMiAgendaHoy: cobrosProcedure
		.input(
			z.object({
				page: z.number().int().positive().default(1),
				perPage: z.number().int().min(1).max(200).default(50),
			}),
		)
		.handler(async ({ context, input }) => {
			const asesorId = context.session?.user?.id;
			if (!asesorId) {
				return {
					fecha: toDateStrGT(new Date()),
					page: input.page,
					perPage: input.perPage,
					total: 0,
					totalPages: 1,
					items: [],
				};
			}
			const fecha = toDateStrGT(new Date());
			const where = and(
				eq(agendaCobrosSnapshots.fechaGt, fecha),
				eq(agendaCobrosSnapshots.asesorId, asesorId),
			);
			// Paginado server-side: un asesor puede tener 16k+ créditos
			// planificados en el mismo snapshot (ver CHUNK_SIZE_SNAPSHOT_ITEMS en
			// jobs/agenda-cobros-snapshots.ts) — traer todo de una vez, correr
			// cerrarItemsAgenda sobre el total y devolverlo entero puede colgar
			// al cliente eventual de este endpoint (Codex PR #1332).
			const [{ total }] = await db
				.select({ total: count() })
				.from(agendaCobrosSnapshotItems)
				.innerJoin(
					agendaCobrosSnapshots,
					eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
				)
				.where(where);
			const items = await db
				.select({
					id: agendaCobrosSnapshotItems.id,
					numeroCreditoSifco: agendaCobrosSnapshotItems.numeroCreditoSifco,
					casoCobroId: agendaCobrosSnapshotItems.casoCobroId,
					motivoAgenda: agendaCobrosSnapshotItems.motivoAgenda,
					bucketSnapshot: agendaCobrosSnapshotItems.bucketSnapshot,
					promesaCumplida: agendaCobrosSnapshotItems.promesaCumplida,
					promesaCumplidaEn: agendaCobrosSnapshotItems.promesaCumplidaEn,
				})
				.from(agendaCobrosSnapshotItems)
				.innerJoin(
					agendaCobrosSnapshots,
					eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
				)
				.where(where)
				.orderBy(asc(agendaCobrosSnapshotItems.numeroCreditoSifco))
				.limit(input.perPage)
				.offset((input.page - 1) * input.perPage);
			const base = {
				fecha,
				page: input.page,
				perPage: input.perPage,
				total,
				totalPages: Math.max(1, Math.ceil(total / input.perPage)),
			};
			if (items.length === 0) return { ...base, items: [] };

			// Resolver el contratoId PRIMERO por el casoCobroId que el snapshot
			// ya congeló (item.casoCobroId), NO por el caso vigente actual del
			// SIFCO: numero_credito_sifco no tiene índice único, un mismo
			// crédito puede tener varios casos_cobros (reaperturas,
			// migraciones, altas manuales — ver caso-vigente.ts). SIFCO solo
			// entra como fallback para item.casoCobroId=null (item D-0, que
			// siempre nace sin caso — ver agenda-cobros-source.ts) — mismo
			// criterio que getCumplimientoAgendaDetalle (Codex, PR #1332).
			const casoCobroIdsDirectos = [
				...new Set(
					items
						.map((item) => item.casoCobroId)
						.filter((id): id is string => id !== null),
				),
			];
			const casosDirectos = casoCobroIdsDirectos.length
				? await db
						.select({
							id: casosCobros.id,
							contratoId: casosCobros.contratoId,
						})
						.from(casosCobros)
						.where(inArray(casosCobros.id, casoCobroIdsDirectos))
				: [];
			const contratoIdPorCasoCobroId = new Map(
				casosDirectos.map((c) => [c.id, c.contratoId]),
			);

			const sifcosSinCaso = [
				...new Set(
					items
						.filter((item) => item.casoCobroId === null)
						.map((item) => item.numeroCreditoSifco),
				),
			];
			const casosPorSifco = sifcosSinCaso.length
				? await db
						.select({
							id: casosCobros.id,
							numeroCreditoSifco: casosCobros.numeroCreditoSifco,
							contratoId: casosCobros.contratoId,
							activo: casosCobros.activo,
							updatedAt: casosCobros.updatedAt,
						})
						.from(casosCobros)
						.where(inArray(casosCobros.numeroCreditoSifco, sifcosSinCaso))
				: [];
			const casoPorSifco = agruparCasosVigentesPorSifco(casosPorSifco);

			const contratoIdsCliente = [
				...new Set(
					[
						...contratoIdPorCasoCobroId.values(),
						...[...casoPorSifco.values()].map((caso) => caso.contratoId),
					].filter((id): id is string => id !== null),
				),
			];
			const contratosCliente = contratoIdsCliente.length
				? await db
						.select({
							id: contratosFinanciamiento.id,
							clienteNombre: clients.contactPerson,
						})
						.from(contratosFinanciamiento)
						.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
						.where(inArray(contratosFinanciamiento.id, contratoIdsCliente))
				: [];
			const clienteNombrePorContratoAgenda = new Map(
				contratosCliente.map((c) => [c.id, c.clienteNombre]),
			);

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
				...base,
				items: items.map((item) => {
					const cerrado = cerradoPorSifco.get(item.numeroCreditoSifco);
					const contratoId = item.casoCobroId
						? contratoIdPorCasoCobroId.get(item.casoCobroId)
						: casoPorSifco.get(item.numeroCreditoSifco)?.contratoId;
					return {
						...item,
						clienteNombre: contratoId
							? (clienteNombrePorContratoAgenda.get(contratoId) ?? null)
							: null,
						atendido: cerrado?.atendido ?? false,
						atendidoEn: cerrado?.atendidoEn ?? null,
						resultadoContacto: cerrado?.resultadoContacto ?? null,
						contactoCobroId: cerrado?.contactoCobroId ?? null,
					};
				}),
			};
		}),
	/**
	 * Catálogo liviano de "quién tiene agenda ese día", SIN filtrar por
	 * estado — a diferencia de `getCumplimientoAgendaResumen`/`Detalle`, que sí
	 * filtran `cerrado` a propósito: `totalAtendidos` y `atendido` por item
	 * solo los escribe el job de cierre nocturno, así que un snapshot todavía
	 * `abierto` (la agenda de HOY, que nunca se cierra hasta esa noche) sale
	 * con 0 atendidos/0% aunque el asesor venga trabajando bien — mostrar eso
	 * sería un dato ENGAÑOSO, no solo incompleto.
	 *
	 * Este procedure no expone esas métricas — solo si existe la fila y en qué
	 * estado — así que sirve de catálogo para el selector de "Cumplimiento de
	 * agenda" sin ese riesgo: un asesor con agenda de hoy (abierta) debe poder
	 * elegirse igual, aunque el resumen no muestre su avance hasta el cierre
	 * (hallazgo de code review, Codex).
	 */
	getAsesoresConAgenda: cobrosSupervisorProcedure
		.input(z.object({ fecha: fechaSchema }))
		.handler(async ({ input }) => {
			return await db
				.select({
					asesorId: agendaCobrosSnapshots.asesorId,
					asesorNombre: user.name,
					estado: agendaCobrosSnapshots.estado,
				})
				.from(agendaCobrosSnapshots)
				.innerJoin(user, eq(agendaCobrosSnapshots.asesorId, user.id))
				.where(eq(agendaCobrosSnapshots.fechaGt, input.fecha))
				.orderBy(asc(user.name));
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
				page: z.number().int().positive().default(1),
				perPage: z.number().int().min(1).max(200).default(50),
			}),
		)
		.handler(async ({ input }) => {
			// Paginado server-side: un asesor puede tener 16k+ créditos
			// planificados en el snapshot (ver CHUNK_SIZE_SNAPSHOT_ITEMS en
			// jobs/agenda-cobros-snapshots.ts) — traer todo de una vez congelaba
			// el navegador del supervisor al expandir la fila (Codex PR #1332).
			const where = and(
				eq(agendaCobrosSnapshots.fechaGt, input.fecha),
				eq(agendaCobrosSnapshots.asesorId, input.asesorId),
				eq(agendaCobrosSnapshots.estado, "cerrado"),
			);
			const [{ total }] = await db
				.select({ total: count() })
				.from(agendaCobrosSnapshotItems)
				.innerJoin(
					agendaCobrosSnapshots,
					eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
				)
				.where(where);
			const items = await db
				.select({
					id: agendaCobrosSnapshotItems.id,
					numeroCreditoSifco: agendaCobrosSnapshotItems.numeroCreditoSifco,
					casoCobroId: agendaCobrosSnapshotItems.casoCobroId,
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
					contactosCobros,
					eq(agendaCobrosSnapshotItems.contactoCobroId, contactosCobros.id),
				)
				.where(where)
				.orderBy(
					asc(agendaCobrosSnapshotItems.atendido),
					desc(agendaCobrosSnapshotItems.motivoAgenda),
					asc(agendaCobrosSnapshotItems.numeroCreditoSifco),
				)
				.limit(input.perPage)
				.offset((input.page - 1) * input.perPage);

			// Resolver el contratoId PRIMERO por el casoCobroId que el snapshot
			// ya congeló (item.casoCobroId), NO por el caso vigente actual del
			// SIFCO: numero_credito_sifco no tiene índice único, un mismo
			// crédito puede tener varios casos_cobros (reaperturas,
			// migraciones, altas manuales — ver caso-vigente.ts). Si se
			// resolviera solo por SIFCO, un item viejo enlazado (link del
			// front) a un caso A mostraría el clienteNombre del caso B si B es
			// el vigente ahora — nombre y link señalando a casos distintos.
			// SIFCO solo entra como fallback para los item.casoCobroId=null
			// (item D-0, que siempre nace sin caso — ver
			// agenda-cobros-source.ts) (Codex, PR #1332).
			const casoCobroIdsDirectos = [
				...new Set(
					items
						.map((item) => item.casoCobroId)
						.filter((id): id is string => id !== null),
				),
			];
			const casosDirectos = casoCobroIdsDirectos.length
				? await db
						.select({
							id: casosCobros.id,
							contratoId: casosCobros.contratoId,
						})
						.from(casosCobros)
						.where(inArray(casosCobros.id, casoCobroIdsDirectos))
				: [];
			const contratoIdPorCasoCobroId = new Map(
				casosDirectos.map((c) => [c.id, c.contratoId]),
			);

			const sifcosSinCaso = [
				...new Set(
					items
						.filter((item) => item.casoCobroId === null)
						.map((item) => item.numeroCreditoSifco),
				),
			];
			const casosPorSifco = sifcosSinCaso.length
				? await db
						.select({
							id: casosCobros.id,
							numeroCreditoSifco: casosCobros.numeroCreditoSifco,
							contratoId: casosCobros.contratoId,
							activo: casosCobros.activo,
							updatedAt: casosCobros.updatedAt,
						})
						.from(casosCobros)
						.where(inArray(casosCobros.numeroCreditoSifco, sifcosSinCaso))
				: [];
			const casoPorSifco = agruparCasosVigentesPorSifco(casosPorSifco);

			const contratoIds = [
				...new Set(
					[
						...contratoIdPorCasoCobroId.values(),
						...[...casoPorSifco.values()].map((caso) => caso.contratoId),
					].filter((id): id is string => id !== null),
				),
			];
			const contratos = contratoIds.length
				? await db
						.select({
							id: contratosFinanciamiento.id,
							clienteNombre: clients.contactPerson,
						})
						.from(contratosFinanciamiento)
						.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
						.where(inArray(contratosFinanciamiento.id, contratoIds))
				: [];
			const clienteNombrePorContrato = new Map(
				contratos.map((c) => [c.id, c.clienteNombre]),
			);

			return {
				fecha: input.fecha,
				asesorId: input.asesorId,
				page: input.page,
				perPage: input.perPage,
				total,
				totalPages: Math.max(1, Math.ceil(total / input.perPage)),
				items: items.map((item) => {
					const contratoId = item.casoCobroId
						? contratoIdPorCasoCobroId.get(item.casoCobroId)
						: casoPorSifco.get(item.numeroCreditoSifco)?.contratoId;
					return {
						...item,
						clienteNombre: contratoId
							? (clienteNombrePorContrato.get(contratoId) ?? null)
							: null,
						// Completado = atendido POR CONTACTO o promesa_cumplida POR PAGO
						// real — mismo criterio que usa el cierre nocturno para
						// total_atendidos/total_pendientes
						// (jobs/agenda-cobros-snapshots.ts). Derivarlo solo de
						// `atendido` contradecía el resumen para un item pagado sin
						// contacto el mismo día (Codex, PR #1332).
						pendiente: !item.atendido && !item.promesaCumplida,
					};
				}),
			};
		}),
};
