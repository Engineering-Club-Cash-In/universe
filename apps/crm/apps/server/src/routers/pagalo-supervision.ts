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
 *
 * La consulta en sí vive en lib/pagalo-supervision-consulta.ts, compartida con
 * la ruta HTTP que consume cartera-back. Acá queda solo la resolución de
 * permisos y scope desde la sesión del CRM.
 */

import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import {
	type AsesorPoolPagalo,
	asesoresConBucketsCompatibles,
	buscarAsesorPorEmail,
	buscarAsesorPorId,
} from "../lib/pagalo-supervision-acceso";
import {
	camposFiltroSupervision,
	consultarSupervisionPagalo,
	MAX_GRUPOS_POR_PAGINA,
	MAX_LIMIT_SUPERVISION,
} from "../lib/pagalo-supervision-consulta";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";

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

export interface DatosAsesorSeleccionado {
	asesorId: number;
	nombre: string;
}

export interface ResultadoScopePagalo {
	sifcosPermitidos: Set<string> | null;
	forbidden: boolean;
	bucketsAsignados: number[] | null;
	asesorSeleccionado: DatosAsesorSeleccionado | null;
}

/**
 * Mismo cálculo de scope que usa el handler ORPC de abajo, extraído para que
 * la ruta HTTP de exportación (/api/pagalo/supervision/{excel,pdf} en
 * index.ts) resuelva el mismo universo de SIFCOs antes de pedirle el reporte
 * a cartera-back — sin este paso, un usuario con scope acotado (rol cobros)
 * podría exportar TODA la cartera, no solo lo que ve en pantalla.
 *
 * Devuelve también bucketsAsignados y asesorSeleccionado para que el handler
 * ORPC reutilice la misma llamada a cartera-back en vez de pedir el pool dos
 * veces consecutivas en cada refresco.
 */
export async function resolverSifcosPermitidosPagalo(
	contexto: {
		userRole: string | undefined;
		userEmail: string | null | undefined;
	},
	asesorId?: number,
): Promise<ResultadoScopePagalo> {
	const puedeVerTodo = PERMISSIONS.canAssignCobros(contexto.userRole ?? "");
	if (asesorId && !puedeVerTodo) {
		return {
			sifcosPermitidos: null,
			forbidden: true,
			bucketsAsignados: null,
			asesorSeleccionado: null,
		};
	}

	const necesitaScope = !puedeVerTodo || asesorId !== undefined;
	if (!necesitaScope) {
		return {
			sifcosPermitidos: null,
			forbidden: false,
			bucketsAsignados: null,
			asesorSeleccionado: null,
		};
	}

	const asesores = await carteraBackClient.getPoolPorAsesor({ useCache: false });
	const asesorSeleccionado = asesorId
		? buscarAsesorPorId(asesores, asesorId)
		: null;
	const asesorPropio = puedeVerTodo
		? null
		: buscarAsesorPorEmail(asesores, contexto.userEmail);
	const scopeAsesor = asesorId
		? await resolverScopeAsesorPagalo(asesorSeleccionado)
		: await resolverScopeAsesorPagalo(asesorPropio);

	const bucketsAsignados = asesorId
		? (asesorSeleccionado?.buckets ?? [])
		: (asesorPropio?.buckets ?? []);

	const datosAsesorSeleccionado = asesorSeleccionado
		? {
				asesorId: asesorSeleccionado.asesor_id,
				nombre: asesorSeleccionado.nombre,
			}
		: null;

	return {
		sifcosPermitidos: scopeAsesor.sifcosPermitidos,
		forbidden: false,
		bucketsAsignados,
		asesorSeleccionado: datosAsesorSeleccionado,
	};
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
			return asesoresConBucketsCompatibles(asesores).map(
				({ asesor_id, nombre, buckets }) => ({
					asesorId: asesor_id,
					nombre,
					buckets,
				}),
			);
		}),

	// Supervisor/admin ve toda la cartera. Rol cobros recibe solo créditos en
	// buckets de su pool actual, resuelto server-side antes de cualquier conteo.
	getPagaloSupervision: cobrosProcedure
		.input(
			z.object({
				...camposFiltroSupervision,
				asesorId: z.number().int().positive().optional(),
				limit: z
					.number()
					.int()
					.min(1)
					.max(MAX_LIMIT_SUPERVISION)
					.default(MAX_GRUPOS_POR_PAGINA),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.handler(async ({ input, context }) => {
			const {
				sifcosPermitidos,
				forbidden,
				bucketsAsignados,
				asesorSeleccionado,
			} = await resolverSifcosPermitidosPagalo(
				{
					userRole: context.userRole,
					userEmail: context.session?.user?.email,
				},
				input.asesorId,
			);
			if (forbidden) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tenés permiso para filtrar por otro asesor.",
				});
			}

			if (sifcosPermitidos?.size === 0) {
				return {
					grupos: [],
					total: 0,
					conteoPorEstado: {},
					resumenKpis: {
						grupos: 0,
						capitalTotal: "0",
						facturableTotal: "0",
						totalAmount: "0",
						linksTotal: 0,
						linksPagados: 0,
					},
					bucketsAsignados,
					asesorSeleccionado,
				};
			}

			const resultado = await consultarSupervisionPagalo(input, {
				sifcosPermitidos,
			});

			return {
				...resultado,
				bucketsAsignados,
				asesorSeleccionado,
			};
		}),
};
