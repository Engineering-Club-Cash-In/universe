/**
 * CB-127 · Núcleo de consulta de la bandeja de supervisión Págalo, sin
 * resolución de permisos: el scope de SIFCOs entra ya resuelto por el llamador.
 *
 * Extraído del handler ORPC para que la ruta HTTP servidor-a-servidor que
 * consume cartera-back (y con ella carteraFront) comparta exactamente la misma
 * consulta. Dos copias de este armado de filtros se separarían a la primera
 * corrección que se hiciera en una sola.
 */

import { and, asc, count, desc, eq, exists, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	PAGALO_PAYMENT_GROUP_STATUSES,
	PAGALO_PAYMENT_LINK_STATUSES,
	type PagaloPaymentGroupStatus,
	type PagaloPaymentLinkStatus,
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	condicionesFiltro,
	condicionGrupoProblematico,
	condicionSifcosPermitidos,
} from "./pagalo-supervision-filtros";

export const MAX_GRUPOS_POR_PAGINA = 25;
export const MAX_LIMIT_SUPERVISION = 100;
export const COLUMNAS_ORDENABLES_SUPERVISION = [
	"totalAmount",
	"createdAt",
] as const;
export type ColumnaOrdenableSupervision =
	(typeof COLUMNAS_ORDENABLES_SUPERVISION)[number];

const COLUMNA_ORDEN = {
	totalAmount: pagaloPaymentGroups.totalAmount,
	createdAt: pagaloPaymentGroups.createdAt,
} as const;

/** Campos del filtro compartidos por la entrada ORPC y la ruta HTTP. */
export const camposFiltroSupervision = {
	// Validados contra los estados reales: un valor fuera de la lista (un typo,
	// una UI desactualizada) devolvía 200 con cero filas, que se lee como "no hay
	// nada" en vez de como un filtro inválido.
	estados: z.array(z.enum(PAGALO_PAYMENT_GROUP_STATUSES)).optional(),
	problemasLink: z.array(z.enum(PAGALO_PAYMENT_LINK_STATUSES)).optional(),
	soloHuerfanos: z.boolean().optional(),
	antiguedadMinDias: z.number().int().positive().optional(),
	numeroSifco: z.string().trim().optional(),
	fechaDesde: z.string().date().optional(),
	fechaHasta: z.string().date().optional(),
	sortBy: z.enum(COLUMNAS_ORDENABLES_SUPERVISION).default("createdAt"),
	sortDir: z.enum(["asc", "desc"]).default("desc"),
	soloProblematicos: z.boolean().default(true),
};

export type FiltrosSupervisionPagalo = {
	estados?: PagaloPaymentGroupStatus[];
	problemasLink?: PagaloPaymentLinkStatus[];
	soloHuerfanos?: boolean;
	antiguedadMinDias?: number;
	numeroSifco?: string;
	fechaDesde?: string;
	fechaHasta?: string;
	sortBy: ColumnaOrdenableSupervision;
	sortDir: "asc" | "desc";
	soloProblematicos: boolean;
	limit: number;
	offset: number;
};

/** ORDER BY seguro: columna siempre de esta whitelist, nunca del input crudo. */
export function ordenSupervision(
	sortBy: ColumnaOrdenableSupervision,
	sortDir: "asc" | "desc",
) {
	const columna = COLUMNA_ORDEN[sortBy];
	const direccion = sortDir === "asc" ? asc : desc;
	// Desempate estable por fecha cuando se ordena por monto, y por ID
	// como desempate final determinista entre páginas con LIMIT/OFFSET.
	return sortBy === "createdAt"
		? [direccion(columna), desc(pagaloPaymentGroups.id)]
		: [
				direccion(columna),
				desc(pagaloPaymentGroups.createdAt),
				desc(pagaloPaymentGroups.id),
			];
}

export type ResultadoSupervisionPagalo = Awaited<
	ReturnType<typeof consultarSupervisionPagalo>
>;

/**
 * @param sifcosPermitidos `null` = sin recorte (supervisor/admin, o llamada
 * servidor-a-servidor ya autorizada). Un Set vacío lo maneja el llamador.
 */
export async function consultarSupervisionPagalo(
	input: FiltrosSupervisionPagalo,
	contexto: { sifcosPermitidos: Set<string> | null },
) {
	const { sifcosPermitidos } = contexto;

	const condicionesExplicitas = condicionesFiltro({
		estados: input.estados,
		soloHuerfanos: input.soloHuerfanos,
		antiguedadMinDias: input.antiguedadMinDias,
		fechaDesde: input.fechaDesde,
		fechaHasta: input.fechaHasta,
	});
	const problemasLink = input.problemasLink;
	// problemasLink (estado de link, no de grupo) cuenta como filtro explícito:
	// si no, con problemasLink como único filtro activo la consulta caía igual en
	// condicionGrupoProblematico() y excluía grupos con un link problemático cuyo
	// estado de GRUPO no es "problemático" (p. ej. PENDING_PAYMENT reciente con un
	// link ERROR) — el filtro pedido quedaba intersectado con uno que nadie pidió.
	const hayFiltrosExplicitos =
		condicionesExplicitas.length > 0 || !!problemasLink?.length;
	const condicionPrincipal = hayFiltrosExplicitos
		? condicionesExplicitas.length > 0
			? and(...condicionesExplicitas)
			: undefined
		: input.soloProblematicos
			? condicionGrupoProblematico()
			: undefined;
	const condiciones = condicionPrincipal ? [condicionPrincipal] : [];
	if (sifcosPermitidos) {
		condiciones.push(condicionSifcosPermitidos([...sifcosPermitidos]));
	}
	if (input.numeroSifco) {
		// Búsqueda parcial (contiene, no igualdad exacta): el supervisor escribe un
		// fragmento del SIFCO ("3540"), no el número completo con todos los ceros a
		// la izquierda ("01010214103540").
		condiciones.push(
			ilike(pagaloPaymentGroups.numeroCreditoSifco, `%${input.numeroSifco}%`),
		);
	}
	// EXISTS correlacionado: filtro y paginación quedan en la DB en vez de traer
	// todos los grupos con todos sus links a memoria del server para filtrarlos.
	if (problemasLink?.length) {
		condiciones.push(
			exists(
				db
					.select({ uno: pagaloPaymentLinks.id })
					.from(pagaloPaymentLinks)
					.where(
						and(
							eq(pagaloPaymentLinks.groupId, pagaloPaymentGroups.id),
							inArray(pagaloPaymentLinks.status, problemasLink),
						),
					),
			),
		);
	}
	const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

	// Conteo por estado para los chips: sobre el universo completo salvo
	// numeroSifco y rango de fecha, no sobre el filtro de estados activo. Así el
	// chip "Falló al aplicar (2)" sigue mostrando 2 aunque haya otro chip activo —
	// es lo que le dice al supervisor qué más hay para mirar.
	const condicionesConteo = sifcosPermitidos
		? [condicionSifcosPermitidos([...sifcosPermitidos])]
		: [];
	if (input.numeroSifco) {
		condicionesConteo.push(
			ilike(pagaloPaymentGroups.numeroCreditoSifco, `%${input.numeroSifco}%`),
		);
	}
	condicionesConteo.push(
		...condicionesFiltro({
			fechaDesde: input.fechaDesde,
			fechaHasta: input.fechaHasta,
		}),
	);
	const conteoWhere =
		condicionesConteo.length > 0 ? and(...condicionesConteo) : undefined;
	const conteoPorEstadoFilas = await db
		.select({
			status: pagaloPaymentGroups.status,
			total: count(),
		})
		.from(pagaloPaymentGroups)
		.where(conteoWhere)
		.groupBy(pagaloPaymentGroups.status);
	const conteoPorEstado: Record<string, number> = {};
	for (const fila of conteoPorEstadoFilas) {
		conteoPorEstado[fila.status] = fila.total;
	}

	const [{ total }] = await db
		.select({ total: count() })
		.from(pagaloPaymentGroups)
		.where(whereClause);

	if (total === 0) return { grupos: [], total: 0, conteoPorEstado };

	const pagina = await db
		.select({
			id: pagaloPaymentGroups.id,
			status: pagaloPaymentGroups.status,
			origen: pagaloPaymentGroups.origen,
			casoCobroId: pagaloPaymentGroups.casoCobroId,
			numeroCreditoSifco: pagaloPaymentGroups.numeroCreditoSifco,
			carteraCreditoId: pagaloPaymentGroups.carteraCreditoId,
			totalAmount: pagaloPaymentGroups.totalAmount,
			capitalTotal: pagaloPaymentGroups.capitalTotal,
			facturableTotal: pagaloPaymentGroups.facturableTotal,
			dispatchAttemptCount: pagaloPaymentGroups.dispatchAttemptCount,
			nextDispatchAt: pagaloPaymentGroups.nextDispatchAt,
			lastDispatchError: pagaloPaymentGroups.lastDispatchError,
			carteraImportId: pagaloPaymentGroups.carteraImportId,
			createdAt: pagaloPaymentGroups.createdAt,
			creadoPor: user.name,
		})
		.from(pagaloPaymentGroups)
		.leftJoin(user, eq(user.id, pagaloPaymentGroups.createdBy))
		.where(whereClause)
		.orderBy(...ordenSupervision(input.sortBy, input.sortDir))
		.limit(input.limit)
		.offset(input.offset);

	if (pagina.length === 0) return { grupos: [], total, conteoPorEstado };

	const links = await db
		.select({
			id: pagaloPaymentLinks.id,
			groupId: pagaloPaymentLinks.groupId,
			linkType: pagaloPaymentLinks.linkType,
			status: pagaloPaymentLinks.status,
			generation: pagaloPaymentLinks.generation,
			pollAttempts: pagaloPaymentLinks.pollAttempts,
			errorCode: pagaloPaymentLinks.errorCode,
			errorMessage: pagaloPaymentLinks.errorMessage,
			lastPollError: pagaloPaymentLinks.lastPollError,
			activatedAt: pagaloPaymentLinks.activatedAt,
			createdAt: pagaloPaymentLinks.createdAt,
			paymentUrl: pagaloPaymentLinks.paymentUrl,
			transactionAmount: pagaloPaymentLinks.transactionAmount,
		})
		.from(pagaloPaymentLinks)
		.where(
			inArray(
				pagaloPaymentLinks.groupId,
				pagina.map((c) => c.id),
			),
		);
	const linksPorGrupo = new Map<string, typeof links>();
	for (const link of links) {
		const arr = linksPorGrupo.get(link.groupId) ?? [];
		arr.push(link);
		linksPorGrupo.set(link.groupId, arr);
	}

	// Motivo de cierre de cada link (invalidado por supervisor, o cerrado por
	// Págalo). Solo para los links de ESTA página.
	//
	// LINK_REGENERATED_BY_SUPERVISOR NO entra acá aunque también tenga motivo y
	// linkId: describe por qué se REGENERÓ, no por qué se CERRÓ, y ocurre después
	// del cierre — ganaría por ser el evento más reciente y taparía el motivo real.
	const linkIdsPagina = pagina.flatMap(
		(g) => linksPorGrupo.get(g.id)?.map((l) => l.id) ?? [],
	);
	const motivoPorLink = new Map<string, string>();
	if (linkIdsPagina.length > 0) {
		const eventosCierre = await db
			.select({
				linkId: pagaloPaymentEvents.linkId,
				payload: pagaloPaymentEvents.payload,
				eventType: pagaloPaymentEvents.eventType,
			})
			.from(pagaloPaymentEvents)
			.where(
				and(
					inArray(pagaloPaymentEvents.linkId, linkIdsPagina),
					inArray(pagaloPaymentEvents.eventType, [
						"LINK_INVALIDATED_BY_SUPERVISOR",
						"LINK_TERMINAL",
					]),
				),
			)
			.orderBy(desc(pagaloPaymentEvents.occurredAt));
		for (const evento of eventosCierre) {
			if (!evento.linkId || motivoPorLink.has(evento.linkId)) continue;
			const payload = evento.payload as { motivo?: string } | null;
			if (payload?.motivo) motivoPorLink.set(evento.linkId, payload.motivo);
		}
	}

	// Nombre real del cliente: vive en cartera-back, no en el join local
	// (casosCobros.contratoId puede ser null y romper la cadena hacia `clients`).
	// Una sola llamada bulk para los sifcos de ESTA página. Si cartera-back falla,
	// la bandeja igual se muestra sin nombres.
	const nombrePorSifco = new Map<string, string>();
	const sifcosPagina = [...new Set(pagina.map((g) => g.numeroCreditoSifco))];
	if (sifcosPagina.length > 0) {
		try {
			const listado = await carteraBackClient.getAllCreditos({
				mes: 0,
				anio: new Date().getFullYear(),
				numeros_credito_sifco: sifcosPagina,
				page: 1,
				perPage: sifcosPagina.length,
			});
			for (const fila of listado.data) {
				if (fila.creditos.numero_credito_sifco && fila.usuarios?.nombre) {
					nombrePorSifco.set(
						fila.creditos.numero_credito_sifco,
						fila.usuarios.nombre,
					);
				}
			}
		} catch (error) {
			console.error(
				"[Págalo] No se pudo resolver nombres de cliente para la bandeja de supervisión:",
				error instanceof Error ? error.message : error,
			);
		}
	}

	// EL asesor dueño de cada crédito (`creditos.asesor_id`), no el pool de
	// elegibles del bucket: un crédito lo lleva UNA persona — la que eligió
	// procesarMoras entre el pool del bucket destino (elegirAsesorParaBucket,
	// latefee.ts). El pool responde "quién PUEDE atenderlo" y devuelve varios
	// solapados, que en una columna "Asesor" se leía como si el crédito tuviera
	// dos dueños, y podía además no incluir al real. Mismo criterio que
	// resolverAsesorVigente en jobs/pagalo-dispatch.ts.
	//
	// Si cartera-back falla, la bandeja se muestra sin nombres en vez de no
	// mostrarse: la columna es informativa, no define el alcance (eso lo hace
	// sifcosPermitidos, resuelto antes de cualquier conteo).
	const asesorPorSifco = new Map<string, string>();
	if (sifcosPagina.length > 0) {
		try {
			const duenos = (
				await carteraBackClient.getAsesorPorSifco({ sifcos: sifcosPagina })
			).data;
			for (const dueno of duenos) {
				asesorPorSifco.set(dueno.numero_credito_sifco, dueno.nombre);
			}
		} catch (error) {
			console.error(
				"[Págalo] No se pudo resolver el asesor de los créditos de la página:",
				error instanceof Error ? error.message : error,
			);
		}
	}

	return {
		grupos: pagina.map((grupo) => ({
			...grupo,
			clienteNombre: nombrePorSifco.get(grupo.numeroCreditoSifco) ?? null,
			asesoresNombres: (() => {
				const dueno = asesorPorSifco.get(grupo.numeroCreditoSifco);
				return dueno ? [dueno] : [];
			})(),
			links: (linksPorGrupo.get(grupo.id) ?? []).map((link) => ({
				...link,
				motivoCierre: motivoPorLink.get(link.id) ?? null,
			})),
		})),
		total,
		conteoPorEstado,
	};
}
