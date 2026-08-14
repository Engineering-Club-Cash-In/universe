/**
 * CB-128 — Historial de agendas de cobros, segmentado por bucket.
 *
 * Responde "¿qué agendó/gestionó cada persona, cuándo, sobre qué cuenta y en
 * qué bucket estaba en ese momento?". Antes había que cruzar a mano el cierre
 * diario (agregados del día), la Ficha 360 de cada crédito (uno a uno) y el
 * historial de buckets.
 *
 * ── De dónde sale el dato ─────────────────────────────────────────────────
 *
 * La agenda NO se persiste: `getAgendaDia` se calcula en vivo contra
 * `cuotas/proximas-vencer` de cartera-back. Lo que sí queda registrado como
 * actividad agendada vive en `contactos_cobros` (`fecha_proximo_contacto`,
 * `proximo_paso`, `fecha_alerta`, `estado_promesa`), que es append-only. Por
 * eso este módulo LEE lo que ya existe en vez de crear una tabla de agenda
 * paralela que duplicaría el estado.
 *
 * ── Archivo aparte, no dentro de cobros.ts ────────────────────────────────
 *
 * Mismo motivo que `bucket-capacidad.ts`: `cobrosAppRouter` está en el límite
 * donde TS7056 trunca SILENCIOSAMENTE el tipo inferido, y agregar keys ahí hace
 * desaparecer procedures del tipo de `orpc` en el web sin ningún error de
 * compilación. Archivo aparte = módulo con su propio tipo.
 *
 * ── Escala ────────────────────────────────────────────────────────────────
 *
 * El negocio proyecta 5× los créditos actuales a 5 años ⇒ ~500k-800k filas en
 * `contactos_cobros`. Tres defensas, todas en `lib/historial-agendas.ts`:
 * ventana de fechas obligatoria (nunca se escanea la historia entera), COUNT(*)
 * acotado a 10,001, y enriquecimiento por lotes en vez de subqueries por fila.
 * Los índices que las sostienen están en la migración 0033.
 */

import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	contactosCobros,
	contactosCobrosAudit,
	contratosFinanciamiento,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import { condicionAuditManual } from "../lib/audit-contactos";
import {
	BUCKET_SIN_ASIGNAR,
	calcularTotalPaginas,
	columnaOrigen,
	esContactoEfectivo,
	esSinContacto,
	interpretarConteo,
	LIMITE_CONTEO,
	LIMITE_USUARIOS_CATALOGO,
	ordenHistorial,
	whereHistorial,
} from "../lib/historial-agendas";
import { cobrosProcedure } from "../lib/orpc";
import { PERMISSIONS, USER_ROLE_VALUES } from "../lib/roles";

/**
 * Catálogo de resultados de gestión. Espejo del enum `estado_contacto` del
 * schema — se replica acá y no se importa el enum de drizzle porque zod
 * necesita un tuple literal para inferir el tipo del input.
 */
const ESTADOS_CONTACTO = [
	"contactado",
	"no_contesta",
	"numero_equivocado",
	"promesa_pago",
	"acuerdo_parcial",
	"rechaza_pagar",
] as const;

/** Espejo del enum `metodo_contacto`. */
const METODOS_CONTACTO = [
	"llamada",
	"whatsapp",
	"sms",
	"email",
	"visita_domicilio",
	"carta_notarial",
] as const;

const filtrosSchema = z.object({
	desde: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	hasta: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	usuarioIds: z.array(z.string()).optional(),
	// Validado contra el catálogo real de roles (USER_ROLE_VALUES) y no como
	// string suelto: así el tipo que sale de zod ya calza con la columna enum y
	// un rol inexistente se rechaza en el borde en vez de producir un filtro que
	// nunca matchea nada.
	roles: z.array(z.enum(USER_ROLE_VALUES)).optional(),
	// Buckets reales 0-5, más BUCKET_SIN_ASIGNAR (-1) para aislar las gestiones
	// con `bucket_snapshot` NULL. El -1 no es un bucket del catálogo: lo traduce
	// `construirCondiciones` a `IS NULL`.
	buckets: z.array(z.number().int().min(BUCKET_SIN_ASIGNAR).max(5)).optional(),
	estadoContacto: z.array(z.enum(ESTADOS_CONTACTO)).optional(),
	metodoContacto: z.array(z.enum(METODOS_CONTACTO)).optional(),
	estadoPromesa: z.enum(["pendiente", "cumplida", "incumplida"]).optional(),
	numeroCreditoSifco: z.string().max(100).optional(),
	soloConProximaAccion: z.boolean().optional(),
	incluirAutomaticos: z.boolean().optional(),
});

const listadoSchema = filtrosSchema.extend({
	page: z.number().int().positive().default(1),
	pageSize: z.number().int().positive().max(200).default(50),
	/**
	 * El export pagina hasta 100 veces sobre el mismo filtro y descarta el total
	 * en todas: con este flag en false se salta el COUNT acotado, que a 500k-800k
	 * filas son 100 conteos de regalo.
	 *
	 * NO existe un flag equivalente para las marcas de edición: el export las
	 * necesita (alimentan su columna "Editado") y el listado también, así que un
	 * flag para apagarlas no tendría caller — sería una entrada muerta en un
	 * procedure público.
	 */
	incluirConteo: z.boolean().default(true),
});

/** Contexto de scoping a partir del rol de la sesión. */
function scopingDe(context: { userId: string; userRole?: string | null }) {
	return {
		userId: context.userId,
		puedeVerTodos: PERMISSIONS.canViewAllCasosCobros(context.userRole ?? ""),
	};
}

export const historialAgendasRouter = {
	/**
	 * Listado paginado del historial (AC-1, AC-2, AC-4, AC-5).
	 *
	 * Gate `cobrosProcedure`, no supervisor: el asesor también consulta SU
	 * historial. El scoping lo fuerza `whereHistorial` según el rol — nunca se
	 * confía en que el front filtre.
	 */
	getHistorialAgendas: cobrosProcedure
		.input(listadoSchema)
		.handler(async ({ input, context }) => {
			const { page, pageSize, incluirConteo, ...filtros } = input;
			const { where, rango } = whereHistorial(filtros, scopingDe(context));

			// El filtro por rol se aplica sobre el join a `user`; va aparte del
			// where base porque `whereHistorial` solo conoce contactos_cobros.
			const condicionesConRol = filtros.roles?.length
				? and(where, inArray(user.role, filtros.roles))
				: where;

			const filas = await db
				.select({
					id: contactosCobros.id,
					fechaContacto: contactosCobros.fechaContacto,
					// AC-2: usuario y rol de quien ejecutó la gestión.
					usuarioId: contactosCobros.realizadoPor,
					usuarioNombre: user.name,
					usuarioRol: user.role,
					// AC-2: el bucket DE ENTONCES, no el de hoy.
					bucketSnapshot: contactosCobros.bucketSnapshot,
					// AC-2: cuenta / cliente relacionado.
					casoCobroId: contactosCobros.casoCobroId,
					numeroCreditoSifco: casosCobros.numeroCreditoSifco,
					clienteNombre: clients.contactPerson,
					// AC-2: tipo de gestión y resultado.
					metodoContacto: contactosCobros.metodoContacto,
					estadoContacto: contactosCobros.estadoContacto,
					comentarios: contactosCobros.comentarios,
					// AC-2: próxima acción.
					fechaProximoContacto: contactosCobros.fechaProximoContacto,
					proximoPaso: contactosCobros.proximoPaso,
					requiereSeguimiento: contactosCobros.requiereSeguimiento,
					// Promesa (cuando aplica).
					estadoPromesa: contactosCobros.estadoPromesa,
					cuotaInicio: contactosCobros.cuotaInicio,
					cuotaFin: contactosCobros.cuotaFin,
					incluyeMora: contactosCobros.incluyeMora,
					montoComprometido: contactosCobros.montoComprometido,
					fechaAlerta: contactosCobros.fechaAlerta,
					// AC-2 pide "fecha/hora de creación y actualización". La de creación
					// es `fechaContacto`; esta es la de actualización. NULL = nunca se
					// tocó desde que se creó.
					//
					// OJO: la tocan también los recálculos de estado del sistema, así que
					// NO significa "lo editó alguien" — para eso está `fueEditadoManual`,
					// que sale del audit. Se exponen las dos porque responden preguntas
					// distintas: cuándo cambió la fila vs. si un humano la cambió.
					updatedAt: contactosCobros.updatedAt,
					// Para que la UI explique por qué una fila 'contactado' no cuenta
					// como gestión del asesor.
					origen: columnaOrigen(),
				})
				.from(contactosCobros)
				.innerJoin(user, eq(contactosCobros.realizadoPor, user.id))
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.where(condicionesConRol)
				.orderBy(...ordenHistorial())
				.limit(pageSize)
				.offset((page - 1) * pageSize);

			// COUNT acotado: a 800k filas contar exacto con filtros cuesta lo mismo
			// que la query. Se cuenta hasta el techo y la UI muestra "10,000+".
			//
			// Los joins replican EXACTAMENTE los del listado, incluidos los LEFT a
			// contratos/clientes. Hoy esos dos no cambian la cardinalidad y omitirlos
			// daría el mismo número, pero el WHERE es compartido: en cuanto se agregue
			// un filtro por nombre de cliente, la subquery fallaría con "missing
			// FROM-clause entry" o —peor— devolvería un total distinto al listado.
			const conteo = incluirConteo
				? await db
						.select({ n: sql<number>`count(*)::int` })
						.from(
							db
								.select({ uno: sql`1` })
								.from(contactosCobros)
								.innerJoin(user, eq(contactosCobros.realizadoPor, user.id))
								.innerJoin(
									casosCobros,
									eq(contactosCobros.casoCobroId, casosCobros.id),
								)
								.leftJoin(
									contratosFinanciamiento,
									eq(casosCobros.contratoId, contratosFinanciamiento.id),
								)
								.leftJoin(
									clients,
									eq(contratosFinanciamiento.clientId, clients.id),
								)
								.where(condicionesConRol)
								.limit(LIMITE_CONTEO)
								.as("acotado"),
						)
				: [];
			// Sin conteo (export): `total` y `totalPaginas` viajan en NULL, no con el
			// largo de la página. Devolver `filas.length` los dejaba plausibles y
			// MAL —una página llena reportaba `totalPaginas: 1`—, así que un caller
			// que los leyera por descuido paginaba una sola vez y perdía el resto en
			// silencio. En null son inservibles por accidente, que es lo correcto:
			// quien apaga el conteo pagina hasta que una página vuelva incompleta.
			const { total, esAproximado } = incluirConteo
				? interpretarConteo(Number(conteo[0]?.n ?? 0))
				: { total: null, esAproximado: false };

			// AC-6 — marca de edición MANUAL, por lote y no con un LATERAL por fila:
			// con 50 filas por página serían 50 subqueries contra una tabla que
			// también crece. Mismo patrón de enriquecimiento con inArray que usa
			// getAgendaDia para evitar N+1.
			const ids = filas.map((f) => f.id);
			const marcas = ids.length
				? await db
						.select({
							contactoId: contactosCobrosAudit.contactoId,
							ultimaEdicion: sql<Date>`max(${contactosCobrosAudit.editadoEn})`,
							vecesEditado: sql<number>`count(*)::int`,
						})
						.from(contactosCobrosAudit)
						.where(
							and(
								inArray(contactosCobrosAudit.contactoId, ids),
								// Solo humanos: una promesa que cambió de estado por el job
								// NO debe verse como "editada" — el usuario leería "alguien
								// tocó esto" cuando no pasó tal cosa.
								condicionAuditManual(),
							),
						)
						.groupBy(contactosCobrosAudit.contactoId)
				: [];
			const marcaPorId = new Map(marcas.map((m) => [m.contactoId, m]));

			return {
				items: filas.map((f) => {
					const marca = marcaPorId.get(f.id);
					return {
						...f,
						fueEditadoManual: marca != null,
						ultimaEdicion: marca?.ultimaEdicion ?? null,
						vecesEditado: marca?.vecesEditado ?? 0,
					};
				}),
				total,
				totalEsAproximado: esAproximado,
				page,
				pageSize,
				totalPaginas:
					total === null ? null : calcularTotalPaginas(total, pageSize),
				// La UI muestra qué ventana se aplicó cuando el usuario no eligió una.
				rangoAplicado: {
					desde: rango.desde,
					hasta: rango.hasta,
					esDefault: rango.esDefault,
				},
				// Para que el encabezado diga "todo el equipo" vs "solo tus gestiones".
				verTodos: PERMISSIONS.canViewAllCasosCobros(context.userRole ?? ""),
			};
		}),

	/**
	 * KPIs del mismo conjunto filtrado.
	 *
	 * Una sola pasada con COUNT(*) FILTER — nunca una query por card. Query
	 * separada de la del listado (no paginada) para que paginar no recalcule los
	 * agregados.
	 */
	getHistorialAgendasResumen: cobrosProcedure
		.input(filtrosSchema)
		.handler(async ({ input, context }) => {
			const { where } = whereHistorial(input, scopingDe(context));
			const condicionesConRol = input.roles?.length
				? and(where, inArray(user.role, input.roles))
				: where;

			const [totales] = await db
				.select({
					total: sql<number>`count(*)::int`,
					efectivos: sql<number>`count(*) FILTER (WHERE ${esContactoEfectivo()})::int`,
					promesas: sql<number>`count(*) FILTER (WHERE ${contactosCobros.estadoContacto} = 'promesa_pago')::int`,
					sinContacto: sql<number>`count(*) FILTER (WHERE ${esSinContacto()})::int`,
					conProximaAccion: sql<number>`count(*) FILTER (WHERE ${contactosCobros.fechaProximoContacto} IS NOT NULL)::int`,
					// Ediciones MANUALES, contadas contra el audit y no contra
					// `updated_at`: esa columna la tocan también los UPDATE de sistema
					// que solo recalculan estado_promesa, así que contarla daría
					// "editadas" infladas con promesas que nadie tocó (ver la nota de
					// updated_at en db/schema/cobros.ts).
					//
					// El predicado sale de `condicionAuditManual()`, el mismo que usa el
					// listado para la marca "Editado". Escribirlo crudo acá haría que
					// KPI y tabla pudieran divergir en la misma pantalla sin error de
					// compilación si el criterio de "manual" cambia.
					editadas: sql<number>`count(*) FILTER (WHERE EXISTS (
						SELECT 1 FROM ${contactosCobrosAudit}
						WHERE ${contactosCobrosAudit.contactoId} = ${contactosCobros.id}
						  AND ${condicionAuditManual()}
					))::int`,
				})
				.from(contactosCobros)
				.innerJoin(user, eq(contactosCobros.realizadoPor, user.id))
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.where(condicionesConRol);

			// Distribución por bucket — el eje que pide el ticket. Las filas sin
			// snapshot —previas a CB-128, o créditos fuera del funnel
			// (EN_CONVENIO/CANCELADO/…), que no tienen bucket por diseño— se
			// agrupan bajo `null` y la UI las pinta
			// como "Sin bucket" en vez de esconderlas: son historial válido.
			//
			// Se calcula IGNORANDO el propio filtro de bucket (pero respetando todos
			// los demás), porque estos conteos son los chips con los que el usuario
			// ELIGE el bucket en la UI. Si se aplicara el filtro a sí mismo, al
			// seleccionar B2 desaparecerían los otros chips y no habría forma de
			// cambiar de bucket sin limpiar el filtro primero. Es el mismo criterio
			// que usa getUsuariosConGestiones con `usuarioIds`.
			const { where: whereSinBucket } = whereHistorial(
				{ ...input, buckets: undefined },
				scopingDe(context),
			);
			const porBucket = await db
				.select({
					bucket: contactosCobros.bucketSnapshot,
					cantidad: sql<number>`count(*)::int`,
				})
				.from(contactosCobros)
				.innerJoin(user, eq(contactosCobros.realizadoPor, user.id))
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.where(
					input.roles?.length
						? and(whereSinBucket, inArray(user.role, input.roles))
						: whereSinBucket,
				)
				.groupBy(contactosCobros.bucketSnapshot)
				.orderBy(asc(contactosCobros.bucketSnapshot));

			return {
				total: Number(totales?.total ?? 0),
				efectivos: Number(totales?.efectivos ?? 0),
				promesas: Number(totales?.promesas ?? 0),
				sinContacto: Number(totales?.sinContacto ?? 0),
				conProximaAccion: Number(totales?.conProximaAccion ?? 0),
				editadas: Number(totales?.editadas ?? 0),
				porBucket: porBucket.map((b) => ({
					bucket: b.bucket,
					cantidad: Number(b.cantidad),
				})),
			};
		}),

	/**
	 * Catálogo del filtro de usuario: SOLO quien tiene gestiones registradas.
	 *
	 * No se usa `getUsuariosCobros` (que trae todo `cobros` +
	 * `cobros_supervisor` + `admin`) porque incluye ~15 admins de sistemas y
	 * dirección que nunca gestionaron una cuenta: el desplegable salía con 25
	 * nombres para 10 que tenían filas, y crece con cada admin nuevo aunque no
	 * toque cobros nunca.
	 *
	 * Mismo criterio que ya aplica el cierre diario ("solo asesores con cierre
	 * generado en el rango elegido, no el catálogo completo" —
	 * routes/cobros/cierre.tsx). Tampoco se usa `getAsesores`: ese viene de
	 * cartera-back con `asesor_id: number`, y acá se filtra por `user.id` del
	 * CRM (lo que guarda `contactos_cobros.realizado_por`).
	 *
	 * Se acota a los MISMOS filtros del listado, no solo al rango de fechas: si
	 * el supervisor mira el bucket B2, el desplegable ofrece únicamente a quienes
	 * gestionaron en B2. Ofrecer a alguien que no aparece bajo los filtros
	 * activos solo produce una tabla vacía sin explicación visible.
	 *
	 * `usuarioIds` se excluye a propósito (ver el pick de abajo): filtrar el
	 * catálogo por la selección actual lo dejaría con un solo nombre y haría
	 * imposible cambiar de usuario sin limpiar el filtro primero.
	 */
	getUsuariosConGestiones: cobrosProcedure
		.input(filtrosSchema)
		.handler(async ({ input, context }) => {
			// Mismo where del listado MENOS la selección de usuarios, para que el
			// catálogo no se auto-restrinja a quien ya está elegido. Incluye el
			// scoping por rol: un asesor solo se ve a sí mismo.
			const { usuarioIds: _ignorado, ...filtrosCatalogo } = input;
			const { where } = whereHistorial(filtrosCatalogo, scopingDe(context));
			// El filtro por rol vive en el join a `user`, igual que en el listado.
			const condiciones = input.roles?.length
				? and(where, inArray(user.role, input.roles))
				: where;

			// El DISTINCT se resuelve con GROUP BY sobre `realizado_por` y un LIMIT,
			// no con selectDistinct sobre las columnas de `user`. Dos motivos:
			//
			//  - Cota real. Sin LIMIT, la query no está acotada por nada más que el
			//    rango de fechas, y se dispara en CADA cambio de filtro. El
			//    resultado son ~10 filas, pero el trabajo para llegar a ellas crece
			//    con el rango — a 800k filas eso es escanear el rango entero para
			//    devolver una decena de nombres.
			//  - El agrupado va por la columna INDEXADA de contactos_cobros
			//    (`realizado_por`), no por columnas de la tabla `user` traídas por
			//    el join, así que Postgres puede resolverlo sin materializar el
			//    join completo antes de deduplicar.
			//
			// El techo es holgado a propósito: el universo real son los usuarios con
			// rol de cobros (~decenas). Si alguna vez se alcanzara, el desplegable
			// mostraría un subconjunto — degradación aceptable para un filtro, y muy
			// preferible a una query sin cota en el camino de cada tecleo.
			const idsConGestiones = db
				.select({ realizadoPor: contactosCobros.realizadoPor })
				.from(contactosCobros)
				.innerJoin(user, eq(contactosCobros.realizadoPor, user.id))
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.where(condiciones)
				.groupBy(contactosCobros.realizadoPor)
				.limit(LIMITE_USUARIOS_CATALOGO);

			return await db
				.select({
					id: user.id,
					name: user.name,
					role: user.role,
				})
				.from(user)
				.where(inArray(user.id, idsConGestiones))
				.orderBy(asc(user.name));
		}),

	/**
	 * AC-6 — bitácora de una gestión concreta: qué se cambió, cuándo y quién.
	 *
	 * Solo supervisor: el detalle expone los valores anteriores completos de la
	 * promesa, que es información de auditoría, no de operación diaria.
	 *
	 * Se gatea con `cobrosProcedure` + chequeo explícito de
	 * `canViewAllCasosCobros` y NO con `cobrosSupervisorProcedure`: ese usa
	 * `canAssignCobros`, y la UI decide mostrar el popover con
	 * `canViewAllCasosCobros`. Hoy los dos predicados dan el mismo conjunto
	 * (admin + cobros_supervisor), pero si alguien cambia uno, el front ofrecería
	 * un botón que el backend rechaza. Un solo predicado en ambos lados.
	 */
	getAuditoriaContacto: cobrosProcedure
		.input(z.object({ contactoId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole ?? "")) {
				throw new ORPCError("FORBIDDEN", {
					message: "Solo supervisores pueden ver la auditoría de una gestión.",
				});
			}

			const filas = await db
				.select({
					id: contactosCobrosAudit.id,
					accion: contactosCobrosAudit.accion,
					origen: contactosCobrosAudit.origen,
					valoresAnteriores: contactosCobrosAudit.valoresAnteriores,
					editadoPor: contactosCobrosAudit.editadoPor,
					editadoPorNombre: user.name,
					editadoEn: contactosCobrosAudit.editadoEn,
				})
				.from(contactosCobrosAudit)
				.leftJoin(user, eq(contactosCobrosAudit.editadoPor, user.id))
				.where(eq(contactosCobrosAudit.contactoId, input.contactoId))
				.orderBy(desc(contactosCobrosAudit.editadoEn))
				// Cota defensiva: una fila con cientos de entradas sería un bug, pero
				// no debe poder tumbar el popover.
				.limit(100);

			return filas;
		}),
};
