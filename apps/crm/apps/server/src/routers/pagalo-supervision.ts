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
			const datosAsesorSeleccionado = asesorSeleccionado
				? {
						asesorId: asesorSeleccionado.asesor_id,
						nombre: asesorSeleccionado.nombre,
					}
				: null;

			if (sifcosPermitidos?.size === 0) {
				return {
					grupos: [],
					total: 0,
					conteoPorEstado: {},
					bucketsAsignados,
					asesorSeleccionado: datosAsesorSeleccionado,
				};
			}

			const resultado = await consultarSupervisionPagalo(input, {
				sifcosPermitidos,
			});

			return {
				...resultado,
				bucketsAsignados,
				asesorSeleccionado: datosAsesorSeleccionado,
			};
		}),
};
