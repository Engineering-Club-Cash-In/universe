import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	lte,
	max,
	not,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	agendaCobrosSnapshotItems,
	agendaCobrosSnapshots,
	casosCobros,
	coberturasAgendaCobros,
	contactosCobros,
	contratosFinanciamiento,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import {
	cerrarItemsAgenda,
	type MotivoAgenda,
	prioridadMotivo,
	ventanaDiaGuatemala,
} from "../lib/agenda-cobros-snapshot";
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
import { ESTADOS_CONTESTO } from "../lib/gestion-temprana-b1";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { esGestionAutomatica } from "../lib/historial-agendas";
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
			const ventanaHoy = ventanaDiaGuatemala(fecha);
			// Una cobertura reemplaza tareas de agenda, nunca el dueño de cartera.
			// Se resuelve en lectura para que una cobertura creada antes o después
			// de la captura del snapshot produzca el mismo resultado.
			const coberturas = await db
				.select({
					titularId: coberturasAgendaCobros.titularId,
					createdAt: coberturasAgendaCobros.createdAt,
					canceladaEn: coberturasAgendaCobros.canceladaEn,
				})
				.from(coberturasAgendaCobros)
				.where(
					and(
						eq(coberturasAgendaCobros.suplenteId, asesorId),
						isNull(coberturasAgendaCobros.canceladaEn),
						lte(coberturasAgendaCobros.desde, fecha),
						gte(coberturasAgendaCobros.hasta, fecha),
					),
				);
			const ausenciaPropia = await db
				.select({ id: coberturasAgendaCobros.id })
				.from(coberturasAgendaCobros)
				.where(
					and(
						eq(coberturasAgendaCobros.titularId, asesorId),
						isNull(coberturasAgendaCobros.canceladaEn),
						lte(coberturasAgendaCobros.desde, fecha),
						gte(coberturasAgendaCobros.hasta, fecha),
					),
				)
				.limit(1);
			// Coberturas donde el usuario logueado fue TITULAR, canceladas hoy:
			// el espejo de `coberturasCanceladasHoy` de abajo, pero del otro
			// lado. Al cancelarse, `ausenciaPropia` deja de bloquearlo y
			// recupera su agenda completa de inmediato — pero el trabajo que el
			// EX-suplente ya hizo esa mañana, antes de cancelar, no queda en
			// ningún lado si no se trae acá: el titular la vería pendiente pese
			// al contacto efectivo real, riesgo de llamar dos veces al mismo
			// cliente. Se necesita el `suplenteId` de esas filas (no solo saber
			// que existieron) para incluirlo en `asesoresParaContactos` más
			// abajo.
			const coberturasPropiasCanceladasHoy = await db
				.select({
					suplenteId: coberturasAgendaCobros.suplenteId,
					createdAt: coberturasAgendaCobros.createdAt,
					canceladaEn: coberturasAgendaCobros.canceladaEn,
				})
				.from(coberturasAgendaCobros)
				.where(
					and(
						eq(coberturasAgendaCobros.titularId, asesorId),
						gte(coberturasAgendaCobros.canceladaEn, ventanaHoy.desde),
						lt(coberturasAgendaCobros.canceladaEn, ventanaHoy.hasta),
						lte(coberturasAgendaCobros.desde, fecha),
						gte(coberturasAgendaCobros.hasta, fecha),
					),
				);
			// Solo cobertura ACTIVA decide qué agenda completa se muestra. Una
			// cobertura cancelada hoy NO vuelve a traer al titular acá — mostrar
			// TODA su agenda de nuevo expondría al suplente los mismos pendientes
			// que el titular, ya sin cobertura, vuelve a ver por su cuenta (dos
			// personas podían terminar llamando al mismo cliente).
			const asesoresFuente = [
				...(ausenciaPropia.length ? [] : [asesorId]),
				...coberturas.map((c) => c.titularId),
			];
			// Cobertura cancelada HOY MISMO: el trabajo que el suplente YA HIZO
			// esta mañana (antes de cancelar) no debe perderse de su propia
			// vista — el cierre nocturno lo acredita igual (mismo criterio en
			// jobs/agenda-cobros-snapshots.ts), pero la vista en vivo del día
			// quedaba ciega a él. A diferencia de arriba, esto NO agrega la
			// agenda completa del titular: más abajo se cruza contra los
			// contactos reales del suplente para traer solo lo ya gestionado.
			//
			// "Hoy" se mide con la MISMA ventana GT que el resto del endpoint
			// (06:00 UTC a 06:00 UTC del día siguiente), no con `::date` crudo:
			// `cancelada_en` se guarda en UTC, y una cancelación de 18:00-23:59
			// hora Guatemala cae en el ::date del día SIGUIENTE en UTC — con la
			// comparación cruda esas cancelaciones tardías (justo las más
			// comunes, al cierre del día laboral) perdían el trabajo previo del
			// suplente, el mismo bug que este cambio quería resolver.
			const coberturasCanceladasHoy = await db
				.select({
					id: coberturasAgendaCobros.id,
					titularId: coberturasAgendaCobros.titularId,
					createdAt: coberturasAgendaCobros.createdAt,
					canceladaEn: coberturasAgendaCobros.canceladaEn,
				})
				.from(coberturasAgendaCobros)
				.where(
					and(
						eq(coberturasAgendaCobros.suplenteId, asesorId),
						gte(coberturasAgendaCobros.canceladaEn, ventanaHoy.desde),
						lt(coberturasAgendaCobros.canceladaEn, ventanaHoy.hasta),
						lte(coberturasAgendaCobros.desde, fecha),
						gte(coberturasAgendaCobros.hasta, fecha),
					),
				);
			const titularesCanceladosHoy = coberturasCanceladasHoy.map(
				(c) => c.titularId,
			);
			if (!asesoresFuente.length && !titularesCanceladosHoy.length) {
				return {
					fecha,
					page: input.page,
					perPage: input.perPage,
					total: 0,
					totalPages: 1,
					items: [],
				};
			}
			const where = and(
				eq(agendaCobrosSnapshots.fechaGt, fecha),
				inArray(agendaCobrosSnapshots.asesorId, asesoresFuente),
			);
			const selectItemsBase = {
				id: agendaCobrosSnapshotItems.id,
				numeroCreditoSifco: agendaCobrosSnapshotItems.numeroCreditoSifco,
				casoCobroId: agendaCobrosSnapshotItems.casoCobroId,
				motivoAgenda: agendaCobrosSnapshotItems.motivoAgenda,
				bucketSnapshot: agendaCobrosSnapshotItems.bucketSnapshot,
				promesaCumplida: agendaCobrosSnapshotItems.promesaCumplida,
				promesaCumplidaEn: agendaCobrosSnapshotItems.promesaCumplidaEn,
				// Dueño REAL del snapshot del item (titular o el propio
				// suplente): cerrarItemsAgenda exige
				// contacto.realizadoPor === item.asesorId, y con cobertura
				// ese dueño no siempre es el usuario logueado.
				snapshotAsesorId: agendaCobrosSnapshots.asesorId,
			};
			const consultarItems = () =>
				db
					.select(selectItemsBase)
					.from(agendaCobrosSnapshotItems)
					.innerJoin(
						agendaCobrosSnapshots,
						eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
					)
					.where(where)
					.orderBy(asc(agendaCobrosSnapshotItems.numeroCreditoSifco));
			// Items de un titular cuya cobertura se canceló HOY: a diferencia de
			// arriba, no se trae su agenda completa (eso duplicaría exposición
			// con el titular, que ya recuperó la suya) — solo los créditos que
			// el SUPLENTE mismo ya contactó HOY bajo esa cobertura, para que su
			// propio trabajo no desaparezca de su vista sin dejar rastro.
			//
			// El JOIN a `coberturasAgendaCobros` (no solo la lista de IDs) es
			// necesario para exigir `fechaContacto < canceladaEn`: sin ese corte
			// exacto, un contacto del EX-suplente sobre un crédito de pool
			// compartido DESPUÉS de la cancelación real también calificaba —
			// trabajo que ya no era de esta cobertura, mientras el titular
			// también lo tiene de vuelta en la suya.
			const idsCoberturasCanceladasHoy = coberturasCanceladasHoy.map(
				(c) => c.id,
			);
			const itemsCanceladosHoyContactados = titularesCanceladosHoy.length
				? await db
						.selectDistinctOn([agendaCobrosSnapshotItems.numeroCreditoSifco], {
							...selectItemsBase,
						})
						.from(agendaCobrosSnapshotItems)
						.innerJoin(
							agendaCobrosSnapshots,
							eq(
								agendaCobrosSnapshotItems.snapshotId,
								agendaCobrosSnapshots.id,
							),
						)
						.innerJoin(
							coberturasAgendaCobros,
							and(
								eq(
									coberturasAgendaCobros.titularId,
									agendaCobrosSnapshots.asesorId,
								),
								// El id, no solo titular+suplente: el mismo par puede
								// tener otra cobertura histórica (ya cancelada, con
								// rango de fechas distinto) sin que la validación de
								// solape la impida — esa validación solo mira
								// coberturas ACTIVAS. Sin acotar por id, el JOIN podía
								// enganchar esa otra fila y usar SU canceladaEn como
								// corte, en vez del de la cobertura real de hoy ya
								// prefiltrada arriba.
								inArray(coberturasAgendaCobros.id, idsCoberturasCanceladasHoy),
							),
						)
						.innerJoin(
							casosCobros,
							eq(
								casosCobros.numeroCreditoSifco,
								agendaCobrosSnapshotItems.numeroCreditoSifco,
							),
						)
						.innerJoin(
							contactosCobros,
							and(
								eq(contactosCobros.casoCobroId, casosCobros.id),
								eq(contactosCobros.realizadoPor, asesorId),
								// Cota inferior: NO `ventanaHoy.desde` (todo el día
								// calendario), sino el registro real de la cobertura. Sin
								// esto, un contacto del ex-suplente sobre un crédito de
								// pool compartido ANTES de que la cobertura existiera
								// también calificaba — mismo hueco de atribución
								// retroactiva ya cerrado en el job nocturno,
								// columnaEnAgendaDeTitular y la query de contactos
								// "en vivo" de más abajo.
								gte(
									contactosCobros.fechaContacto,
									coberturasAgendaCobros.createdAt,
								),
								lt(
									contactosCobros.fechaContacto,
									coberturasAgendaCobros.canceladaEn,
								),
								// Mismo criterio de "contacto efectivo" que usa
								// `cerrarItemsAgenda` para decidir `atendido`. Sin esto,
								// un `no_contesta` o un WhatsApp automático hacía que este
								// JOIN "recuperara" el item, pero cerrarItemsAgenda lo
								// rechazaba después y lo devolvía como pendiente — visible
								// para el suplente mientras el titular también lo recupera
								// pendiente en la suya.
								inArray(contactosCobros.estadoContacto, ESTADOS_CONTESTO),
								not(esGestionAutomatica()),
							),
						)
						.where(
							and(
								eq(agendaCobrosSnapshots.fechaGt, fecha),
								inArray(agendaCobrosSnapshots.asesorId, titularesCanceladosHoy),
							),
						)
				: [];
			let total: number;
			let items: (Awaited<ReturnType<typeof consultarItems>>[number] & {
				dueniosSnapshot: string[];
			})[];
			if (asesoresFuente.length > 1 || itemsCanceladosHoyContactados.length) {
				// Con cobertura, titular y suplente comparten pool de bucket (lo
				// exige crearCobertura), así que un mismo crédito SLA puede salir
				// en AMBOS snapshots. Deduplicar en la página ya cortada no
				// alcanza — infla `total` y puede partir el duplicado entre dos
				// páginas. Mismo patrón que ya usa getColaDia para este mismo
				// problema (routers/cobros.ts): traer todo y paginar en memoria.
				// Caso raro (solo mientras hay cobertura vigente) — sin cobertura
				// sigue paginando en DB, sin cambio de comportamiento.
				//
				// FUSIONAR dueños, no descartar: si el mismo SIFCO sale en el
				// snapshot del titular Y en el del suplente, quedarse con una
				// fila arbitraria pierde el `snapshotAsesorId` de la otra. Si
				// sobrevive la del suplente, un contacto ya hecho por el titular
				// deja de matchear más abajo (`realizadoPorValidos` quedaba sin
				// ese dueño) y el item se veía pendiente aunque ya estaba resuelto.
				//
				// Los DEMÁS campos (sobre todo `motivoAgenda`) sí necesitan un
				// criterio de desempate, no "la primera fila que llega" —el orden
				// de dos filas con igual SIFCO no está garantizado por la query—:
				// si el crédito es D-0 en un snapshot y sla_hoy en el otro, debe
				// prevalecer D-0 (más urgente), igual que ya decide
				// `deduplicarAgenda` para el caso de un asesor único.
				const todos = [
					...(asesoresFuente.length ? await consultarItems() : []),
					...itemsCanceladosHoyContactados,
				];
				const porSifco = new Map<
					string,
					Awaited<ReturnType<typeof consultarItems>>[number] & {
						dueniosSnapshot: string[];
					}
				>();
				for (const item of todos) {
					const previo = porSifco.get(item.numeroCreditoSifco);
					if (!previo) {
						porSifco.set(item.numeroCreditoSifco, {
							...item,
							dueniosSnapshot: [item.snapshotAsesorId],
						});
						continue;
					}
					previo.dueniosSnapshot.push(item.snapshotAsesorId);
					if (
						prioridadMotivo(item.motivoAgenda as MotivoAgenda) <
						prioridadMotivo(previo.motivoAgenda as MotivoAgenda)
					) {
						const dueniosAcumulados = previo.dueniosSnapshot;
						porSifco.set(item.numeroCreditoSifco, {
							...item,
							dueniosSnapshot: dueniosAcumulados,
						});
					}
				}
				// `itemsCanceladosHoyContactados` no tiene `.orderBy()` (su
				// `selectDistinctOn` solo garantiza una fila por SIFCO, no el orden
				// entre SIFCOs distintos) — si es la única fuente (el usuario no
				// tiene cobertura activa, solo items recuperados de una ya
				// cancelada), el `Map` hereda ese orden no determinista de
				// Postgres. Paginar con `slice` sobre un orden inestable repite o
				// salta items entre requests cuando hay más créditos que
				// `perPage`. Mismo criterio de orden que ya usa `consultarItems`.
				const deduplicados = [...porSifco.values()].sort((a, b) =>
					a.numeroCreditoSifco.localeCompare(b.numeroCreditoSifco),
				);
				total = deduplicados.length;
				items = deduplicados.slice(
					(input.page - 1) * input.perPage,
					input.page * input.perPage,
				);
			} else {
				// Paginado server-side: un asesor puede tener 16k+ créditos
				// planificados en el mismo snapshot (ver CHUNK_SIZE_SNAPSHOT_ITEMS
				// en jobs/agenda-cobros-snapshots.ts) — traer todo de una vez, correr
				// cerrarItemsAgenda sobre el total y devolverlo entero puede colgar
				// al cliente eventual de este endpoint (Codex PR #1332).
				const [{ total: totalDb }] = await db
					.select({ total: count() })
					.from(agendaCobrosSnapshotItems)
					.innerJoin(
						agendaCobrosSnapshots,
						eq(agendaCobrosSnapshotItems.snapshotId, agendaCobrosSnapshots.id),
					)
					.where(where);
				total = totalDb;
				const pagina = await consultarItems()
					.limit(input.perPage)
					.offset((input.page - 1) * input.perPage);
				items = pagina.map((item) => ({
					...item,
					dueniosSnapshot: [item.snapshotAsesorId],
				}));
			}
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
			const { desde, hasta } = ventanaHoy;
			// numeroCreditoSifco del caso: mismo fallback de matching que usa el
			// cierre nocturno (contactoPerteneceAlItem) — un item con
			// casoCobroId=null (sin caso CRM vinculado) solo puede matchear por
			// SIFCO, nunca por caso.
			// Mismos dueños que `asesoresFuente` arriba: si el titular ya gestionó
			// un crédito antes de que arrancara/se registrara la cobertura, el
			// suplente debe verlo atendido, no pendiente — sin esto el filtro de
			// snapshots ya traía sus items, pero el de contactos solo miraba al
			// suplente y el trabajo del titular quedaba invisible acá (riesgo de
			// llamar dos veces al mismo cliente).
			//
			// `asesoresFuente` NO siempre incluye a `asesorId`: si el usuario
			// logueado está ausente hoy (`ausenciaPropia`), se excluye a sí
			// mismo de ahí a propósito. Pero puede seguir siendo suplente de OTRA
			// cobertura ya cancelada hoy (`itemsCanceladosHoyContactados`), y ese
			// contacto propio también tiene que entrar acá — si no,
			// `cerrarItemsAgenda` no encuentra ningún contacto para esos items
			// recuperados y los devuelve pendientes pese al contacto efectivo
			// que ya calificó para recuperarlos.
			//
			// El caso INVERSO también aplica: si el usuario logueado es TITULAR
			// y su cobertura se cancela hoy, `ausenciaPropia` deja de bloquearlo
			// y recupera de inmediato TODA su agenda (`asesoresFuente` vuelve a
			// incluirlo) — pero sin agregar al EX-SUPLENTE acá, sus contactos de
			// esa mañana (antes de cancelar) quedan invisibles: el titular ve
			// pendiente algo que ya estaba resuelto.
			const asesoresParaContactos = [
				...new Set([
					...(titularesCanceladosHoy.length
						? [...asesoresFuente, asesorId]
						: asesoresFuente),
					...coberturasPropiasCanceladasHoy.map((c) => c.suplenteId),
				]),
			];
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
						inArray(contactosCobros.realizadoPor, asesoresParaContactos),
						gte(contactosCobros.fechaContacto, desde),
						lt(contactosCobros.fechaContacto, hasta),
					),
				);

			// Ventanas [created_at, cancelada_en) de cada titular: un item cuyo
			// `dueniosSnapshot` incluye a un titular con cobertura vigente hoy
			// solo debe aceptar contactos del suplente que caigan en ALGUNA de
			// sus coberturas. Se combinan la(s) activa(s) y la(s) canceladas hoy
			// (no solo la activa): cancelar y recrear el mismo par el mismo día
			// es posible (la validación de solape solo mira coberturas
			// activas), y un contacto legítimo bajo la cobertura VIEJA no debe
			// evaluarse contra el registro de la NUEVA. Los items de
			// `itemsCanceladosHoyContactados` ya vienen resueltos por su propio
			// `id` exacto en la query — no necesitan esto.
			const ventanasPorTitular = new Map<
				string,
				{ desde: Date; hasta: Date | null }[]
			>();
			for (const c of [
				...coberturas,
				...coberturasCanceladasHoy,
				// El titular es el propio `asesorId`: estas filas se leyeron con
				// `titularId = asesorId` fijo, así que no vienen como columna.
				...coberturasPropiasCanceladasHoy.map((c) => ({
					...c,
					titularId: asesorId,
				})),
			]) {
				const ventanas = ventanasPorTitular.get(c.titularId) ?? [];
				ventanas.push({ desde: c.createdAt, hasta: c.canceladaEn });
				ventanasPorTitular.set(c.titularId, ventanas);
			}
			const cerrados = cerrarItemsAgenda(
				fecha,
				items.map((item) => {
					// `dueniosSnapshot[0]` NO sirve para identificar al dueño real: el
					// orden entre las dos filas fusionadas del dedupe (pool
					// compartido entre titular y suplente) no está garantizado, así
					// que podía devolver al propio `asesorId` en vez del titular. Eso
					// rompía dos cosas a la vez: `contactoPerteneceAlItem` trataría al
					// SUPLENTE como dueño real (exento del corte de fecha) y al
					// TITULAR como ajeno (sujeto a él, cuando el titular siempre debe
					// estar exento); y `createdAtPorTitular` no tiene entrada para el
					// suplente, dejando `contactoValidoDesde` en `undefined` (el guard
					// completo se saltaba sin él). El titular es el único dueño del
					// array que NO es el usuario logueado.
					const titular =
						item.dueniosSnapshot.find((d) => d !== asesorId) ??
						item.dueniosSnapshot[0];
					return {
						asesorId: titular,
						asesorNombre: "",
						numeroCreditoSifco: item.numeroCreditoSifco,
						casoCobroId: item.casoCobroId,
						bucketSnapshot: item.bucketSnapshot,
						motivoAgenda: item.motivoAgenda as MotivoAgenda,
						// El usuario logueado es el único suplente posible en esta
						// vista (es su propia agenda). Si el item es de un titular que
						// cubre, el suplente (él mismo) también puede haberlo cerrado
						// — y si el mismo SIFCO salió en AMBOS snapshots (pool
						// compartido), el dedupe de arriba fusionó los dos dueños en
						// `dueniosSnapshot` en vez de quedarse con uno arbitrario. Sin
						// esto, un contacto ya hecho por el dueño descartado en el
						// dedupe dejaba de matchear y el item se veía pendiente aunque
						// ya estaba resuelto.
						// `dueniosSnapshot` por sí solo NO alcanza cuando el titular
						// recupera su agenda tras cancelar: el ex-suplente nunca tuvo su
						// PROPIO snapshot con este crédito (lo trabajó vía cobertura, no
						// por pool), así que no aparece ahí. Sin agregar explícitamente
						// a los ex-suplentes de `coberturasPropiasCanceladasHoy`, este
						// guard los rechazaba ANTES de siquiera llegar al corte de
						// `ventanasCoberturaValida` — su contacto efectivo, ya calificado
						// por la ventana, nunca se evaluaba.
						//
						// Solo cuando `titular === asesorId`: si el usuario logueado
						// tiene AL MISMO TIEMPO cobertura activa cubriendo a otro Y su
						// propia cobertura (como titular) cancelada hoy, los items del
						// OTRO titular no deben aceptar al ex-suplente de esta persona
						// — sin relación real con esos créditos.
						realizadoPorValidos: [
							...new Set([
								...item.dueniosSnapshot,
								asesorId,
								...(titular === asesorId
									? coberturasPropiasCanceladasHoy.map((c) => c.suplenteId)
									: []),
							]),
						],
						ventanasCoberturaValida: ventanasPorTitular.get(titular),
						// `dueniosSnapshot`, no `[titular]`: si el crédito ya estaba en
						// el propio snapshot del suplente (pool compartido), su trabajo
						// sobre ese item es legítimo sin importar cuándo se registró la
						// cobertura — el corte de arriba es solo para atribuir
						// retroactivamente trabajo AJENO al titular, no para invalidar
						// el trabajo que el suplente ya tenía en su propia cartera.
						contactoExentoDelCorte: item.dueniosSnapshot,
					};
				}),
				contactos,
			);
			const cerradoPorSifco = new Map(
				cerrados.map((c) => [c.numeroCreditoSifco, c]),
			);

			return {
				...base,
				items: items.map((item) => {
					const {
						snapshotAsesorId: _snapshotAsesorId,
						dueniosSnapshot: _dueniosSnapshot,
						...itemPublico
					} = item;
					const cerrado = cerradoPorSifco.get(item.numeroCreditoSifco);
					const contratoId = item.casoCobroId
						? contratoIdPorCasoCobroId.get(item.casoCobroId)
						: casoPorSifco.get(item.numeroCreditoSifco)?.contratoId;
					return {
						...itemPublico,
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

			// CB-114: nombre de quien REALMENTE gestionó cada item. Durante una
			// cobertura el trabajo del suplente se acredita al titular (ver el
			// LEFT JOIN a coberturas_agenda_cobros en
			// jobs/agenda-cobros-snapshots.ts), así que la agenda de un titular
			// ausente puede salir 100% atendida sin que él tocara nada. Sin decir
			// quién fue, el supervisor lee "cumplió" de alguien que estaba de
			// vacaciones. `realizado_por` ya venía en el item, pero como id crudo.
			const realizadoPorIds = [
				...new Set(
					items
						.map((item) => item.realizadoPor)
						.filter((id): id is string => id !== null),
				),
			];
			const nombrePorUserId = new Map(
				realizadoPorIds.length
					? (
							await db
								.select({ id: user.id, name: user.name })
								.from(user)
								.where(inArray(user.id, realizadoPorIds))
						).map((u) => [u.id, u.name])
					: [],
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
					// Cubierto = lo gestionó alguien distinto del dueño de la agenda.
					// Sale del `realizado_por` del PROPIO item (un hecho que el
					// cierre ya registró), no de cruzar SIFCOs entre agendas: si
					// dice que fue otro, fue otro. Por eso acá no hace falta
					// verificar la cobertura —a diferencia de
					// `columnaEnAgendaDeTitular`, que sí infiere y sin ese chequeo
					// confundía pool compartido con cobertura—, y además un día
					// histórico sigue contando lo que pasó ESE día aunque la
					// cobertura se haya cancelado después.
					const cubiertoPor =
						item.realizadoPor && item.realizadoPor !== input.asesorId
							? (nombrePorUserId.get(item.realizadoPor) ?? null)
							: null;
					return {
						...item,
						cubiertoPor,
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
