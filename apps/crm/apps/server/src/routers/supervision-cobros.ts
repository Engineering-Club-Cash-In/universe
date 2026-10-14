/**
 * Rediseño COBROS-02 · Dashboard del supervisor (Figma «CRM Ventas» ›
 * Supervisor › Dashboard · Supervisor, `1954:14`).
 *
 * El dashboard ya arma casi todo con procedimientos existentes (aprobaciones,
 * coberturas, Págalo, carga por bucket, historial de agendas, cierre diario).
 * Lo que el Figma pide y el backend todavía no tiene vive acá:
 *
 * - `getSupervisionComplementos`: CONECTADO y lleno (tareas S1 a S4). Cada
 *   bloque se calcula aparte y, si su fuente falla, llega `null` y el front
 *   muestra "—": nunca tumba el resto. Servicios: services/supervision-
 *   pendientes.ts (S1, S2) y services/supervision-complementos.ts (S3, S4).
 * - `reasignarAsesorCreditosLote` (S6): reasignación en bloque, todo o nada.
 *   Los filtros de la Cartera general (S5) viven en `getTodosLosCreditos`.
 *   Decisiones y avance: docs/features/cobros-02/23-plan-backend-supervision.md
 *   (contrato original: 17-supervision-backend.md).
 *
 * Archivo aparte (y montado aparte en src/index.ts), no en routers/index.ts:
 * `cobrosAppRouter` está en el límite donde TS7056 trunca EN SILENCIO el tipo
 * inferido en el web (ver la nota de routers/bucket-capacidad.ts). El web lo
 * tipa por `orpcAparte` (web/src/utils/orpc.ts).
 */

import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { MOTIVOS_AUSENCIA } from "../lib/ausencia-asesor";
import {
	DECISIONES,
	EVENTOS_BITACORA,
	mensajeFueraDeAlcance,
	TIPOS_BITACORA,
} from "../lib/bitacora-supervision";
import { memoConTtl } from "../lib/memo-ttl";
import { cobrosSupervisorProcedure } from "../lib/orpc";
import { USER_ROLE_VALUES } from "../lib/roles";
import type { ResultadoCartera } from "../lib/supervision-kpis";
import {
	listarAusencias,
	marcarAusenteIndefinido,
	previsualizarRepartoAusencia,
	reactivarAsesor,
} from "../services/ausencias-cobros";
import {
	getBitacoraDecisiones,
	getEscaladasDelAsesor,
} from "../services/bitacora-supervision";
import {
	CarteraBackHttpError,
	carteraBackClient,
} from "../services/cartera-back-client";
import { reconciliarAvisosLlamarCliente } from "../services/inmovilizacion-notif";
import { listarProximosSubirBucket } from "../services/proximos-subir-bucket";
import {
	calcularKpisYEquipo,
	calcularRecuperacionAsesores,
} from "../services/supervision-complementos";
import { contactabilidadPorAsesor } from "../services/supervision-contactabilidad";
import {
	calcularPendientes,
	contarSinContactoEquipo,
} from "../services/supervision-pendientes";

/**
 * «Sin contacto» del equipo (S2) tarda ~3 s (recorre toda la cola) y NO depende
 * del período ni de quien consulta: se guarda 60 s para que cambiar entre Día,
 * Semana y Mes no lo recalcule cada vez.
 */
const sinContactoEquipoMemo = memoConTtl<number>(60_000);

/** 400 si la página pedida queda más allá de lo que la bitácora puede dar. */
function exigirAlcanceBitacora(page: number, perPage: number) {
	const mensaje = mensajeFueraDeAlcance(page, perPage);
	if (mensaje) throw new ORPCError("BAD_REQUEST", { message: mensaje });
}

/** Mismos períodos que el segmentado Día / Semana / Mes del dashboard. */
export const PERIODOS_SUPERVISION = ["dia", "semana", "mes"] as const;

/* ── Contratos de lo que llena José ─────────────────────────────────────────── */

/** Tarea S1 · Pendientes del supervisor que hoy no tienen fuente. */
export interface PendientesSupervision {
	/** Documentos que los asesores pidieron y esperan autorización (se apoya en F6). */
	documentosPorAutorizar: number | null;
	/** Solicitudes de rebaja de mora por revisar (W2). */
	rebajasPorRevisar: number | null;
	/** Créditos que cumplen el criterio para pasar a Prejurídico (B3 a punto de caer a B4; ver lib/prejuridico.ts). */
	listosPrejuridico: number | null;
	/**
	 * Aprobaciones que el supervisor resolvió hoy de los tipos que el Dashboard
	 * ya lista como pendientes (convenios, recuperaciones y apagados). Alimenta
	 * la barra «x de y aprobaciones resueltas hoy».
	 */
	aprobacionesResueltasHoy: number | null;
	/**
	 * Rebajas, documentos y Jurídico que resolvió hoy. Van aparte para que la
	 * barra no cuente resueltas de tipos que aún no están en sus pendientes;
	 * el front las suma a ambos lados cuando agregue esos chips.
	 */
	otrasResueltasHoy: {
		rebajas: number;
		documentos: number;
		juridico: number;
	} | null;
}

/** Tarea S3 · KPIs del equipo en el período (Día / Semana / Mes). */
export interface KpisEquipoSupervision {
	/** Monto recuperado por el equipo y su meta en Q (versión de equipo de B2/B3). */
	recuperacion: {
		monto: number;
		meta: number | null;
		/** Mismo monto en el período anterior, para la tendencia. */
		montoAnterior: number | null;
	} | null;
	/** Cuentas curadas: créditos del equipo que bajaron de bucket en el período. */
	cuentasCuradas: {
		curadas: number;
		/** Universo del que salen (el «/ 70» del Figma). */
		total: number;
		curadasAnterior: number | null;
	} | null;
	/** Promesas de pago del equipo con fecha en el período. */
	promesasCumplidas: {
		cumplidas: number;
		pactadas: number;
		/** Monto prometido que no se pagó (el «−Q28k» del Figma). */
		montoIncumplido: number;
	} | null;
}

/** Tarea S4 · Columnas de la tabla Equipo que no tienen fuente. */
export interface EquipoAsesorSupervision {
	/** asesor_id de cartera (el mismo de getAsesoresTraslados). */
	asesorId: number;
	/** Gestiones manuales que registró hoy, en vivo (el cierre diario corre a las 00:15). */
	contactosHoy: number | null;
	/** Meta del asesor, en %: recuperación del período ÷ su meta prorrateada. */
	meta: number | null;
	/** «Rescate», en %: recuperados ÷ (recuperados + escalados) del período. */
	rescate: number | null;
	/** M1 · Recuperación del asesor en Q con su meta y el período anterior. */
	recuperacion: ResultadoCartera | null;
}

/** Tarea M1 · Resultado de cartera de un asesor (tarjetas de Mi equipo y Detalle). */
export interface RecuperacionAsesorSupervision {
	/** asesor_id de cartera (el mismo de getAsesoresTraslados). */
	asesorId: number;
	recuperacion: ResultadoCartera | null;
}

export const supervisionCobrosRouter = {
	/**
	 * Mismo permiso que el resto de la supervisión de cobros
	 * (`cobrosSupervisorProcedure` = admin + cobros_supervisor).
	 */
	getSupervisionComplementos: cobrosSupervisorProcedure
		.input(z.object({ periodo: z.enum(PERIODOS_SUPERVISION) }))
		.handler(async ({ input, context }) => {
			// S1 + S2 (services/supervision-pendientes.ts). Cada conteo falla solo.
			const [pendientes, sinContacto3Dias] = await Promise.all([
				calcularPendientes({
					userId: context.userId,
					email: context.session?.user?.email,
				}),
				sinContactoEquipoMemo("equipo", () => contarSinContactoEquipo()).catch(
					(error) => {
						console.error("[getSupervisionComplementos] sin contacto:", error);
						return null;
					},
				),
			]);
			// S3 + S4: KPIs del equipo y columnas de la tabla Equipo
			// (services/supervision-complementos.ts). Cada bloque falla solo.
			const { kpis, equipo } = await calcularKpisYEquipo(input.periodo);
			return {
				periodo: input.periodo,
				pendientes,
				sinContacto3Dias,
				kpis,
				equipo,
			};
		}),

	/**
	 * M1 · Recuperación (Q) y resultado de cartera de cada asesor del equipo en
	 * el período, con su meta prorrateada y el período anterior. Es la versión
	 * liviana de las filas de `getSupervisionComplementos`: mismas cifras, sin
	 * calcular el resto del dashboard. Con `asesorId` devuelve solo ese asesor
	 * (Detalle del asesor). `null` si cartera no responde.
	 */
	getRecuperacionAsesores: cobrosSupervisorProcedure
		.input(
			z.object({
				periodo: z.enum(PERIODOS_SUPERVISION),
				asesorId: z.number().int().positive().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const filas = await calcularRecuperacionAsesores(input.periodo);
			if (!filas) return null;
			return input.asesorId == null
				? filas
				: filas.filter((f) => f.asesorId === input.asesorId);
		}),

	/**
	 * M7 · Contactabilidad en lote: efectivos y total de gestiones por asesor en
	 * un rango, en una sola llamada. Reemplaza las N llamadas a
	 * `getHistorialAgendasResumen` (una por asesor) de las tarjetas de Mi equipo
	 * y usa el mismo filtro y la misma definición de «efectivo». Los asesores
	 * pedidos sin gestiones llegan con 0 de 0.
	 */
	getContactabilidadPorAsesor: cobrosSupervisorProcedure
		.input(
			z.object({
				desde: z.string().date().optional(),
				hasta: z.string().date().optional(),
				usuarioIds: z.array(z.string().min(1)).max(500).optional(),
				roles: z.array(z.enum(USER_ROLE_VALUES)).optional(),
			}),
		)
		.handler(async ({ input }) => ({
			asesores: await contactabilidadPorAsesor(input),
		})),

	/**
	 * M3 · Bitácora unificada y paginada de decisiones del supervisor: convenios,
	 * apagados, reactivaciones, recuperaciones, rebajas de mora, Jurídico,
	 * documentos, contrapropuestas de convenio, reasignaciones manuales,
	 * traslados, coberturas y ausencias indefinidas, más recientes primero.
	 * Filtros por tipo, decisión, asesor que pidió y fecha (días de Guatemala,
	 * inclusivos). Con `solicitanteId` o `decisiones` solo entran las
	 * solicitudes (lo demás lo hace el supervisor, no se pide ni se decide).
	 * Reemplaza la unión que el Historial de Solicitudes armaba en el navegador.
	 *
	 * - `eventos`: separa la baja de un asesor (traslado por despido o renuncia)
	 *   del traslado, y la ausencia de la reactivación (coberturas y ausencias
	 *   indefinidas). Solo filtra esos tipos.
	 * - `busqueda`: número de crédito (SIFCO) o nombre del cliente. Deja fuera
	 *   lo que no tiene crédito (traslados, coberturas y ausencias).
	 *
	 * Cada entrada trae además lo que su tipo necesita para el detalle: montos
	 * de la rebaja, nota para Jurídico, bucket, documento, plan de la
	 * contrapropuesta, asesor afectado y cuentas movidas.
	 */
	getBitacoraDecisiones: cobrosSupervisorProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				perPage: z.number().int().min(1).max(50).default(25),
				tipos: z
					.array(z.enum(TIPOS_BITACORA))
					.max(TIPOS_BITACORA.length)
					.optional(),
				decisiones: z
					.array(z.enum(DECISIONES))
					.max(DECISIONES.length)
					.optional(),
				solicitanteId: z.string().min(1).optional(),
				desde: z.string().date().optional(),
				hasta: z.string().date().optional(),
				eventos: z
					.array(z.enum(EVENTOS_BITACORA))
					.max(EVENTOS_BITACORA.length)
					.optional(),
				busqueda: z.string().trim().max(100).optional(),
			}),
		)
		.handler(({ input }) => {
			exigirAlcanceBitacora(input.page, input.perPage);
			return getBitacoraDecisiones(input);
		}),

	/**
	 * M3 · Historial global de decisiones de convenio, paginado (aprobadas y
	 * rechazadas de todos los créditos; cartera borra el convenio rechazado, así
	 * que esta es la única fuente). Mismo formato que la bitácora.
	 */
	getHistorialDecisionesConvenio: cobrosSupervisorProcedure
		.input(
			z.object({
				page: z.number().int().min(1).default(1),
				perPage: z.number().int().min(1).max(50).default(25),
				decision: z.enum(["aprobada", "rechazada"]).optional(),
				solicitanteId: z.string().min(1).optional(),
				desde: z.string().date().optional(),
				hasta: z.string().date().optional(),
			}),
		)
		.handler(({ input }) => {
			exigirAlcanceBitacora(input.page, input.perPage);
			return getBitacoraDecisiones({
				page: input.page,
				perPage: input.perPage,
				tipos: ["convenio"],
				decisiones: input.decision ? [input.decision] : undefined,
				solicitanteId: input.solicitanteId,
				desde: input.desde,
				hasta: input.hasta,
			});
		}),

	/**
	 * M3 · Casos que un asesor escaló: sus solicitudes a Jurídico y de
	 * recuperación del vehículo (el apagado del GPS no cuenta). Alimenta el chip
	 * «Escaladas» de Detalle › Actividad. `userId` es el usuario del CRM del
	 * asesor (`getAsesoresTraslados().userId`).
	 */
	getEscaladasAsesor: cobrosSupervisorProcedure
		.input(
			z.object({
				userId: z.string().min(1),
				desde: z.string().date().optional(),
				hasta: z.string().date().optional(),
				limite: z.number().int().min(1).max(200).default(50),
			}),
		)
		.handler(({ input }) => getEscaladasDelAsesor(input)),

	/**
	 * M2 · Créditos próximos a subir de bucket de un asesor (Detalle › Casos
	 * críticos): B1 a B4 cuya siguiente cuota vence en 7 días o menos y que no
	 * tienen una promesa vigente. Devuelve el conteo, el desglose por bucket y la
	 * lista. `asesorId` es el de cartera (el mismo de la ruta del Detalle).
	 */
	getProximosSubirBucket: cobrosSupervisorProcedure
		.input(z.object({ asesorId: z.number().int().positive() }))
		.handler(({ input }) => listarProximosSubirBucket(input.asesorId)),

	/**
	 * M5 · Previsualiza el reparto de la cartera de un asesor al marcarlo ausente
	 * (Figma «Redistribución»): a quién va cada cuenta, repartido según la
	 * capacidad de cada asesor, y la carga de cada uno antes y después. No toca
	 * nada; el `previewId` vale 10 minutos y es lo que confirma
	 * `marcarAusenteIndefinido`. Las cuentas fuera del funnel (canceladas, caídas…)
	 * no se reparten: se quedan con el asesor.
	 */
	previsualizarRepartoAusencia: cobrosSupervisorProcedure
		.input(
			z.object({
				asesorId: z.number().int().positive(),
				motivo: z.enum(MOTIVOS_AUSENCIA).default("incidente"),
			}),
		)
		.handler(({ input, context }) =>
			previsualizarRepartoAusencia({
				...input,
				actorEmail: context.session.user.email,
			}),
		),

	/**
	 * M5 · Marca ausente a un asesor sin fecha de regreso (motivo Incidente,
	 * Permiso o Vacaciones; el fin queda abierto hasta `reactivarAsesor`). Reparte
	 * su cartera al equipo con el reparto previsualizado y lo saca del pool para
	 * que no reciba cuentas nuevas. `id` lo genera el cliente (reintento seguro).
	 * La cobertura con suplente y fechas cerradas (`crearCobertura`) sigue igual.
	 */
	marcarAusenteIndefinido: cobrosSupervisorProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				asesorId: z.number().int().positive(),
				motivo: z.enum(MOTIVOS_AUSENCIA),
				previewId: z.string().uuid(),
				nota: z.string().trim().max(1000).optional(),
			}),
		)
		.handler(({ input, context }) =>
			marcarAusenteIndefinido({
				...input,
				actor: {
					userId: context.userId,
					role: context.userRole,
					email: context.session.user.email,
				},
			}),
		),

	/**
	 * M5 · Reactiva a un asesor ausente: vuelve al pool, se le devuelve lo que
	 * se repartió (salvo lo que ya cambió de dueño o de bucket) y se avisa al
	 * equipo. Devuelve cuántas cuentas volvieron y cuáles se quedaron.
	 */
	reactivarAsesor: cobrosSupervisorProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(({ input, context }) =>
			reactivarAsesor({
				id: input.id,
				actor: {
					userId: context.userId,
					role: context.userRole,
					email: context.session.user.email,
				},
			}),
		),

	/**
	 * M5 · Ausencias indefinidas (vigentes por defecto) para marcar «Ausente» en
	 * las tarjetas de Mi equipo y mostrar «Reactivar». Va aparte de
	 * `listarCoberturas`, que sigue devolviendo solo las de suplente con fechas.
	 */
	listarAusencias: cobrosSupervisorProcedure
		.input(
			z
				.object({ soloVigentes: z.boolean().default(true) })
				.default({ soloVigentes: true }),
		)
		.handler(({ input }) => listarAusencias(input)),

	/**
	 * S6 · Reasignación en bloque, TODO O NADA. Recibe varios créditos, el asesor
	 * destino y el motivo; cartera valida el lote completo (el pool de cada
	 * bucket, como `reasignarAsesorCredito`) y lo escribe en una sola
	 * transacción. Si un solo crédito no cumple, no se reasigna ninguno y el
	 * error nombra los que fallaron. Los que ya eran del asesor destino se
	 * omiten (no es un error). Reemplaza el ciclo de `reasignarAsesorCredito`
	 * del front, que dejaba la reasignación a medias ante un fallo.
	 */
	reasignarAsesorCreditosLote: cobrosSupervisorProcedure
		.input(
			z.object({
				creditoIds: z
					.array(z.number().int().positive().max(2_147_483_647))
					.min(1, "Seleccione al menos un crédito")
					.max(200, "El máximo es de 200 créditos por lote"),
				asesorNuevoId: z.number().int().positive().max(2_147_483_647),
				motivo: z.string().trim().min(1, "El motivo es obligatorio"),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const res = await carteraBackClient.reasignarAsesorLote({
					credito_ids: [...new Set(input.creditoIds)],
					asesor_nuevo_id: input.asesorNuevoId,
					motivo: input.motivo,
					usuario_email: context.session.user.email,
				});
				// El acceso sigue a cartera: los avisos pendientes de «llamar al
				// cliente» pasan al asesor nuevo (como en la reasignación individual).
				await reconciliarAvisosLlamarCliente();
				return {
					asesorNuevoId: res.asesor_nuevo,
					reasignados: res.reasignados.map((r) => ({
						creditoId: r.credito_id,
						asesorAnteriorId: r.asesor_anterior,
						bucket: r.bucket,
					})),
					omitidos: res.omitidos.map((o) => ({
						creditoId: o.credito_id,
						motivo: o.motivo,
					})),
				};
			} catch (err) {
				if (err instanceof CarteraBackHttpError) {
					const detalle = Array.isArray(err.payload.errores)
						? (err.payload.errores as unknown[])
								.map((e) =>
									typeof e === "string"
										? e
										: ((e as { message?: string })?.message ?? ""),
								)
								.filter(Boolean)
						: [];
					const mensaje = [err.payload.message ?? err.message, ...detalle]
						.join(" ")
						.replace(/\[ERROR\]\s*/g, "");
					// Solo 400 (el lote no cumple) y 409 (cambió o hay un job) son
					// errores esperados del supervisor; 401/403/404/5xx son fallas del
					// servicio y no deben verse como un dato inválido.
					const codigo =
						err.status === 409
							? "CONFLICT"
							: err.status === 400
								? "BAD_REQUEST"
								: "INTERNAL_SERVER_ERROR";
					throw new ORPCError(codigo, {
						message:
							codigo === "INTERNAL_SERVER_ERROR"
								? "No se pudo reasignar el lote: el servicio de cartera no respondió correctamente. Intente de nuevo."
								: mensaje,
						data: { errores: err.payload.errores ?? [] },
					});
				}
				console.error("[reasignarAsesorCreditosLote]", err);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						"No se pudo reasignar el lote de créditos. Intente de nuevo.",
				});
			}
		}),
};
