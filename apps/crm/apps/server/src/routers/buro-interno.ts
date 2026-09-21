import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
	BURO_INTERNO_CATEGORIAS,
	BURO_INTERNO_SEVERIDADES,
} from "../db/schema/buro-interno";
import { analystProcedure, cobrosProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	type ActorBuroInterno,
	actualizarPersona,
	actualizarRegla,
	BuroInternoDuplicadoError,
	BuroInternoNoEncontradoError,
	BuroInternoValidacionError,
	buscarCandidatos,
	consultarPersona,
	crearPersona,
	desactivarPersona,
	evaluarOportunidad,
	listarPersonas,
	OportunidadSinLeadError,
	obtenerHistorial,
	obtenerReglas,
} from "../services/buro-interno";

/**
 * Buró interno: catálogo propio de personas con las que no conviene volver a
 * trabajar (mala paga, fraude, etc.). Cobros lo alimenta desde su módulo y
 * análisis ve las coincidencias al evaluar una oportunidad.
 */

const MOTIVO_MIN = 10;

const datosPersonaSchema = z.object({
	nombres: z.string().trim().min(2, "Ingresá los nombres").max(120),
	apellidos: z.string().trim().min(2, "Ingresá los apellidos").max(120),
	dpi: z.string().trim().max(20).nullish(),
	nit: z.string().trim().max(20).nullish(),
	telefono: z.string().trim().max(30).nullish(),
	direccion: z.string().trim().max(300).nullish(),
	numeroCreditoSifco: z.string().trim().max(40).nullish(),
	categoria: z.enum(BURO_INTERNO_CATEGORIAS),
	motivo: z
		.string()
		.trim()
		.min(MOTIVO_MIN, `El motivo debe tener al menos ${MOTIVO_MIN} caracteres`)
		.max(2000),
});

type ContextoConRol = {
	userId: string;
	userRole?: string | null;
	session?: { session?: { impersonatedBy?: string | null } | null } | null;
};

/**
 * Bajo suplantación responde el admin que la inició, no el usuario suplantado
 * (mismo criterio que `marcarValidacionManual`).
 */
function actorDe(context: ContextoConRol): ActorBuroInterno {
	return {
		id: context.session?.session?.impersonatedBy ?? context.userId,
		rol: context.userRole ?? null,
	};
}

function exigirSupervision(rol: string | null | undefined, accion: string) {
	if (!rol || !PERMISSIONS.canManageBuroInterno(rol)) {
		throw new ORPCError("FORBIDDEN", {
			message: `Solo supervisión de cobros o administración puede ${accion}`,
		});
	}
}

function traducirError(error: unknown): never {
	if (
		error instanceof BuroInternoNoEncontradoError ||
		error instanceof OportunidadSinLeadError
	) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error instanceof BuroInternoDuplicadoError) {
		throw new ORPCError("CONFLICT", { message: error.message });
	}
	if (error instanceof BuroInternoValidacionError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	throw error;
}

export const buroInternoRouter = {
	listBuroInterno: cobrosProcedure
		.input(
			z.object({
				busqueda: z.string().trim().max(100).optional(),
				estado: z.enum(["activos", "inactivos", "todos"]).default("activos"),
				limit: z.number().int().min(1).max(100).default(25),
				offset: z.number().int().min(0).default(0),
			}),
		)
		.handler(async ({ input }) => listarPersonas(input)),

	buscarCandidatosBuroInterno: cobrosProcedure
		.input(z.object({ termino: z.string().trim().min(3).max(100) }))
		.handler(async ({ input }) => buscarCandidatos(input.termino)),

	crearRegistroBuroInterno: cobrosProcedure
		.input(datosPersonaSchema.extend({ leadId: z.string().uuid().nullish() }))
		.handler(async ({ input, context }) => {
			try {
				return await crearPersona(input, actorDe(context));
			} catch (error) {
				traducirError(error);
			}
		}),

	actualizarRegistroBuroInterno: cobrosProcedure
		.input(datosPersonaSchema.extend({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const { id, ...datos } = input;
			try {
				return await actualizarPersona(id, datos, actorDe(context));
			} catch (error) {
				traducirError(error);
			}
		}),

	desactivarRegistroBuroInterno: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				motivo: z
					.string()
					.trim()
					.min(
						MOTIVO_MIN,
						`El motivo debe tener al menos ${MOTIVO_MIN} caracteres`,
					)
					.max(2000),
			}),
		)
		.handler(async ({ input, context }) => {
			exigirSupervision(context.userRole, "quitar a alguien del buró interno");
			try {
				return await desactivarPersona(
					input.id,
					input.motivo,
					actorDe(context),
				);
			} catch (error) {
				traducirError(error);
			}
		}),

	getHistorialBuroInterno: cobrosProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input }) => obtenerHistorial(input.id)),

	consultarBuroInterno: cobrosProcedure
		.input(
			z
				.object({
					nombres: z.string().trim().max(120).optional(),
					apellidos: z.string().trim().max(120).optional(),
					dpi: z.string().trim().max(20).optional(),
					nit: z.string().trim().max(20).optional(),
					telefono: z.string().trim().max(30).optional(),
					direccion: z.string().trim().max(300).optional(),
				})
				.refine(
					(c) => Object.values(c).some((v) => v && v.length > 0),
					"Ingresá al menos un dato para consultar",
				),
		)
		.handler(async ({ input, context }) =>
			consultarPersona(input, actorDe(context)),
		),

	getReglasBuroInterno: cobrosProcedure.handler(async () => obtenerReglas()),

	actualizarReglaBuroInterno: cobrosProcedure
		.input(
			z.object({
				clave: z.string().min(1).max(60),
				activa: z.boolean(),
				severidad: z.enum(BURO_INTERNO_SEVERIDADES),
				parametros: z.record(z.string(), z.unknown()).default({}),
			}),
		)
		.handler(async ({ input, context }) => {
			exigirSupervision(context.userRole, "cambiar las reglas de coincidencia");
			const { clave, ...cambios } = input;
			try {
				return await actualizarRegla(clave, cambios, actorDe(context));
			} catch (error) {
				traducirError(error);
			}
		}),

	/** Para la pantalla de análisis: no bloquea la aprobación, solo avisa */
	getBuroInternoOportunidad: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			try {
				return await evaluarOportunidad(input.opportunityId);
			} catch (error) {
				traducirError(error);
			}
		}),
};
