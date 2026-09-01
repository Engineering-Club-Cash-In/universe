/**
 * CB-127 · Bandeja de supervisión Págalo (`/cobros/pagalo`): grupos en
 * estado problemático de toda la cartera, no solo del caso actual.
 *
 * Módulo aparte, no en cobros.ts: mismo motivo que pagalo-grupo-activo.ts —
 * cobrosAppRouter ya está en el límite donde TS7056 trunca el tipo inferido
 * en el web (comentario en ese archivo). Las acciones de supervisor sobre
 * un grupo/link individual (invalidar, regenerar, allocations) viven en
 * pagalo-link-actions.ts — mismo motivo de PRs separados: esto es lo que
 * consume la bandeja, aquello es lo que consume la Ficha 360.
 */

import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, exists, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	type PagaloPaymentGroupStatus,
	type PagaloPaymentLinkStatus,
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import {
	type AsesorPoolPagalo,
	asesoresActivosConBuckets,
	asesoresConBucketsCompatibles,
	buscarAsesorPorEmail,
	buscarAsesorPorId,
	debeUsarFallbackAtribucion,
	nombresAsesoresPorSifco,
} from "../lib/pagalo-supervision-acceso";
import {
	condicionesFiltro,
	condicionGrupoProblematico,
	condicionSifcosPermitidos,
} from "../lib/pagalo-supervision-filtros";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";

const MAX_GRUPOS_POR_PAGINA = 25;
const CACHE_SCOPE_FALLBACK_MS = 60_000;
const scopeFallbackPorAsesor = new Map<
	number,
	{ venceEn: number; sifcos: string[] }
>();

async function resolverScopeAsesorPagalo(asesor: AsesorPoolPagalo | null) {
	const bucketsAsignados = asesor?.buckets ?? [];
	if (!asesor || bucketsAsignados.length === 0) {
		return { bucketsAsignados, sifcosPermitidos: new Set<string>() };
	}

	return {
		bucketsAsignados,
		sifcosPermitidos: new Set(
			(
				await carteraBackClient.getSifcosPoolAutoritativos({
					asesorId: asesor.asesor_id,
				})
			).data,
		),
	};
}

async function getSifcosPoolFallbackParaColumna(
	asesorId: number,
): Promise<string[]> {
	const cacheado = scopeFallbackPorAsesor.get(asesorId);
	if (cacheado && cacheado.venceEn > Date.now()) return cacheado.sifcos;

	const sifcos = (
		await carteraBackClient.getSifcosPoolAutoritativos({ asesorId })
	).data;
	scopeFallbackPorAsesor.set(asesorId, {
		venceEn: Date.now() + CACHE_SCOPE_FALLBACK_MS,
		sifcos,
	});
	return sifcos;
}

export const pagaloSupervisionRouter = {
	// Catálogo para selector Págalo: solo asesores con por lo menos un bucket
	// activo. El selector no usa getAsesores porque su email/activo no expresa
	// pertenencia al pool que define alcance de esta bandeja.
	getPagaloAsesores: cobrosSupervisorProcedure
		.input(z.object({}))
		.handler(async () => {
			const asesores = await carteraBackClient.getPoolPorAsesor({
				useCache: false,
			});
			return asesoresConBucketsCompatibles(asesores)
				.map(({ asesor_id, nombre, buckets }) => ({
					asesorId: asesor_id,
					nombre,
					buckets,
				}));
		}),

	// Supervisor/admin ve toda la cartera. Rol cobros recibe solo créditos en
	// buckets de su pool actual, resuelto server-side antes de cualquier conteo.
	getPagaloSupervision: cobrosProcedure
		.input(
			z.object({
				estados: z.array(z.string()).optional(),
				problemasLink: z.array(z.string()).optional(),
				soloHuerfanos: z.boolean().optional(),
				antiguedadMinDias: z.number().int().positive().optional(),
				numeroSifco: z.string().trim().optional(),
				asesorId: z.number().int().positive().optional(),
				// Sin esto en `true`, la bandeja parte del predicado "problemático"
				// (REVIEW_REQUIRED/APPLICATION_FAILED/huérfano/estancado). El
				// checkbox "Solo problemáticos" de la UI lo controla; con chips de
				// estado activos, el usuario ya acotó a propósito y ese acotado manda
				// sin importar este flag.
				soloProblematicos: z.boolean().default(true),
				limit: z
					.number()
					.int()
					.min(1)
					.max(MAX_GRUPOS_POR_PAGINA)
					.default(MAX_GRUPOS_POR_PAGINA),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.handler(async ({ input, context }) => {
			const puedeVerTodo = PERMISSIONS.canAssignCobros(context.userRole ?? "");
			if (input.asesorId && !puedeVerTodo) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tenés permiso para filtrar por otro asesor.",
				});
			}

			const necesitaScope = !puedeVerTodo || input.asesorId !== undefined;
			let asesores: AsesorPoolPagalo[] = [];
			try {
				asesores = await carteraBackClient.getPoolPorAsesor({
					useCache: false,
				});
			} catch (error) {
				// Para admin/supervisor sin filtro, el pool solo alimenta columna
				// Asesor: Págalo sigue usable si cartera-back está degradado. Para
				// scope propio o filtro elegido, fallar cerrado conserva autorización.
				if (necesitaScope) throw error;
				console.error(
					"[Págalo] No se pudo resolver catálogo de pools:",
					error instanceof Error ? error.message : error,
				);
			}
			const asesorSeleccionado = input.asesorId
				? buscarAsesorPorId(asesores, input.asesorId)
				: null;
			const asesorPropio = puedeVerTodo
				? null
				: buscarAsesorPorEmail(asesores, context.session?.user?.email);
			const scopeAsesor = input.asesorId
				? await resolverScopeAsesorPagalo(asesorSeleccionado)
				: puedeVerTodo
					? null
					: await resolverScopeAsesorPagalo(asesorPropio);
			const bucketsAsignados = scopeAsesor?.bucketsAsignados ?? null;
			const sifcosPermitidos = scopeAsesor?.sifcosPermitidos ?? null;
			if (sifcosPermitidos?.size === 0) {
				return {
					grupos: [],
					total: 0,
					conteoPorEstado: {},
					bucketsAsignados,
					asesorSeleccionado: asesorSeleccionado
						? {
								asesorId: asesorSeleccionado.asesor_id,
								nombre: asesorSeleccionado.nombre,
							}
						: null,
				};
			}

			const filtroInput = {
				estados: input.estados as PagaloPaymentGroupStatus[] | undefined,
				soloHuerfanos: input.soloHuerfanos,
				antiguedadMinDias: input.antiguedadMinDias,
			};
			const condicionesExplicitas = condicionesFiltro(filtroInput);
			const problemasLink = input.problemasLink as
				| PagaloPaymentLinkStatus[]
				| undefined;
			// problemasLink (estado de link, no de grupo) NO estaba contando como
			// filtro explícito acá — con problemasLink como único filtro activo,
			// condicionPrincipal igual caía en condicionGrupoProblematico() (el
			// predicado "problemático" por defecto, soloProblematicos default
			// true), agregado como AND extra sobre el EXISTS de más abajo. Eso
			// excluía grupos con un link problemático cuyo ESTADO DE GRUPO no
			// caía en la lista de "problemático" (p. ej. PENDING_PAYMENT
			// reciente con un link ERROR) — el filtro que el operador pidió
			// explícitamente quedaba intersectado con uno que no pidió
			// (hallazgo de code review).
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
				// Búsqueda parcial (contiene, no igualdad exacta): el supervisor
				// escribe un fragmento del SIFCO ("3540"), no el número completo
				// con todos los ceros a la izquierda ("01010214103540") — con eq()
				// esa búsqueda nunca matcheaba nada (hallazgo de code review).
				condiciones.push(
					ilike(
						pagaloPaymentGroups.numeroCreditoSifco,
						`%${input.numeroSifco}%`,
					),
				);
			}
			// problemasLink se resuelve en SQL con un EXISTS correlacionado —
			// antes se traían TODOS los grupos y TODOS sus links a memoria del
			// server para filtrar y paginar con .slice(), costo que crecía sin
			// límite con el historial completo (hallazgo de code review). Con
			// esto, filtro y paginación quedan en la DB.
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
			const whereClause =
				condiciones.length > 0 ? and(...condiciones) : undefined;

			// Conteo por estado para los chips de filtro — SIEMPRE sobre el
			// universo completo (solo con numeroSifco aplicado, si lo hay), no
			// sobre el filtro de estados/soloProblematicos activo. Así el chip
			// "Falló al aplicar (2)" sigue mostrando 2 aunque el supervisor tenga
			// otro chip activo — es lo que le dice qué más hay para mirar.
			const condicionesConteo = sifcosPermitidos
				? [condicionSifcosPermitidos([...sifcosPermitidos])]
				: [];
			if (input.numeroSifco) {
				condicionesConteo.push(
					ilike(
						pagaloPaymentGroups.numeroCreditoSifco,
						`%${input.numeroSifco}%`,
					),
				);
			}
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

			if (total === 0) {
				return {
					grupos: [],
					total: 0,
					conteoPorEstado,
					bucketsAsignados,
					asesorSeleccionado: asesorSeleccionado
						? {
								asesorId: asesorSeleccionado.asesor_id,
								nombre: asesorSeleccionado.nombre,
							}
						: null,
				};
			}

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
				.orderBy(desc(pagaloPaymentGroups.createdAt))
				.limit(input.limit)
				.offset(input.offset);

			if (pagina.length === 0) {
				return {
					grupos: [],
					total,
					conteoPorEstado,
					bucketsAsignados,
					asesorSeleccionado: asesorSeleccionado
						? {
								asesorId: asesorSeleccionado.asesor_id,
								nombre: asesorSeleccionado.nombre,
							}
						: null,
				};
			}

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

			// Motivo de cierre de cada link (invalidado por supervisor, o cerrado
			// por Págalo — expirado/cancelado desde su lado): un link REPLACED/
			// EXPIRED/CANCELLED no lo explica solo con el status, y sin esto la
			// bandeja mostraba el link viejo al lado del nuevo sin decir por qué.
			// Solo para los links de ESTA página, mismo criterio de costo que el
			// nombre del cliente más abajo.
			//
			// LINK_REGENERATED_BY_SUPERVISOR NO entra acá aunque también tenga
			// motivo y linkId (el del link viejo, para que aparezca en la
			// bandeja): describe por qué se REGENERÓ, no por qué se CERRÓ, y
			// ocurre después del cierre — si compitiera por el mismo mapa
			// ordenado por fecha, ganaría por ser el evento más reciente y
			// reemplazaría el motivo real de cierre con el de regeneración
			// (hallazgo de code review, yo mismo lo introduje al agregar el
			// linkId a ese evento en una ronda anterior).
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
			// (casosCobros.contratoId puede ser null y romper la cadena hacia
			// `clients`). Una sola llamada bulk para los sifcos de ESTA página
			// (ya paginada en SQL, no el universo completo) — con caché de 5 min
			// del cliente HTTP. Si cartera-back falla, la bandeja igual se
			// muestra sin nombres.
			const nombrePorSifco = new Map<string, string>();
			const sifcosPagina = [
				...new Set(pagina.map((g) => g.numeroCreditoSifco)),
			];
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

			// Misma fuente autoritativa del filtro, pero restringida a SIFCOs de
			// esta página. Evita resolver pools completos por cada asesor.
			const sifcosPorAsesor = new Map<number, string[]>();
			const asesoresVisibles = asesoresActivosConBuckets(asesores);
			const asesoresCompatibles = asesoresConBucketsCompatibles(asesores);
			let usarFallback = false;
			if (sifcosPagina.length > 0) {
				try {
					const asignaciones = (
						await carteraBackClient.getAsignacionesPoolPorSifco({
							sifcos: sifcosPagina,
						})
					).data;
					for (const asignacion of asignaciones) {
						const sifcos = sifcosPorAsesor.get(asignacion.asesor_id) ?? [];
						sifcos.push(asignacion.numero_credito_sifco);
						sifcosPorAsesor.set(asignacion.asesor_id, sifcos);
					}
					usarFallback = debeUsarFallbackAtribucion(
						asesoresVisibles,
						sifcosPagina,
						asignaciones,
					);
					if (usarFallback) {
						console.warn(
							"[Págalo] Atribución bulk vacía; usando compatibilidad pool-sifcos.",
						);
					}
				} catch (error) {
					usarFallback = true;
					console.error(
						"[Págalo] No se pudo resolver asesores de la página:",
						error instanceof Error ? error.message : error,
					);
				}
			}
			if (usarFallback) {
				const scopesFallback = await Promise.all(
					asesoresCompatibles.map(async (asesor) => {
						try {
							return {
								asesorId: asesor.asesor_id,
								sifcos: await getSifcosPoolFallbackParaColumna(
									asesor.asesor_id,
								),
							};
						} catch (error) {
							console.error(
								`[Págalo] No se pudo resolver compatibilidad de ${asesor.nombre}:`,
								error instanceof Error ? error.message : error,
							);
							return { asesorId: asesor.asesor_id, sifcos: [] };
						}
					}),
				);
				for (const scope of scopesFallback) {
					sifcosPorAsesor.set(scope.asesorId, scope.sifcos);
				}
			}
			const asesoresPorSifco = nombresAsesoresPorSifco(
				(usarFallback ? asesoresCompatibles : asesoresVisibles).map((asesor) => ({
					...asesor,
					sifcos: sifcosPorAsesor.get(asesor.asesor_id) ?? [],
				})),
				sifcosPagina,
			);

			return {
				grupos: pagina.map((grupo) => ({
					...grupo,
					clienteNombre: nombrePorSifco.get(grupo.numeroCreditoSifco) ?? null,
					asesoresNombres: asesoresPorSifco.get(grupo.numeroCreditoSifco) ?? [],
					links: (linksPorGrupo.get(grupo.id) ?? []).map((link) => ({
						...link,
						motivoCierre: motivoPorLink.get(link.id) ?? null,
					})),
				})),
				total,
				conteoPorEstado,
				bucketsAsignados,
				asesorSeleccionado: asesorSeleccionado
					? {
							asesorId: asesorSeleccionado.asesor_id,
							nombre: asesorSeleccionado.nombre,
						}
					: null,
			};
		}),
};
