import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { analystProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import {
	ejecutarValidaciones,
	getValidaciones,
	marcarValidacionBuroManual,
	marcarValidacionRenapManual,
	OportunidadNoEncontradaError,
	OverrideDpiInvalidoError,
	OverrideNoAplicaError,
} from "../services/opportunity-validations";

/**
 * Validaciones de RENAP y Buró (Infornet) para oportunidades cuyo origen
 * NO es el bot de WhatsApp. Las oportunidades del bot quedan exentas.
 *
 * Ambos procedimientos exigen rol de análisis: la respuesta incluye score,
 * nivel de riesgo y motivos de rechazo del buró (antecedentes penales,
 * morosidad, PEP), que no deben quedar al alcance de cualquier sesión.
 */
export const validationsRouter = {
	ejecutarValidacionesRenapBuro: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			return ejecutarValidaciones({
				opportunityId: input.opportunityId,
				userId: context.userId,
			});
		}),

	getValidacionesOportunidad: analystProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input }) => {
			try {
				return await getValidaciones({ opportunityId: input.opportunityId });
			} catch (error) {
				if (error instanceof OportunidadNoEncontradaError) {
					throw new ORPCError("NOT_FOUND", { message: error.message });
				}
				throw error;
			}
		}),

	/**
	 * Override manual: el analista verificó a mano en el portal de la fuente
	 * que falló (Infornet o Centinela/RENAP) que el cliente está en orden.
	 * Solo aplica si la última validación de ese tipo está en `estado:'error'`.
	 */
	marcarValidacionManual: analystProcedure
		.meta({ audit: { entity: "opportunity", action: "override_validation" } })
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				tipo: z.enum(["buro", "renap"]),
				motivo: z
					.string()
					.trim()
					.min(10, "El motivo debe tener al menos 10 caracteres"),
			}),
		)
		.handler(async ({ input, context }) => {
			if (!PERMISSIONS.canOverrideValidacionManual(context.userRole)) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes permisos para marcar una validación como manual",
				});
			}

			try {
				const marcar =
					input.tipo === "buro"
						? marcarValidacionBuroManual
						: marcarValidacionRenapManual;

				// Bajo suplantación, `context.userId` es el analista suplantado, no
				// el admin que la inició (Better Auth deja a este último en la
				// sesión, no en el usuario) — mismo criterio que ya usa
				// `auditMiddleware` para no atribuirle el override a la persona
				// equivocada en un rastro de auditoría sensible.
				const actorId =
					context.session?.session?.impersonatedBy ?? context.userId;

				return await marcar({
					opportunityId: input.opportunityId,
					userId: actorId,
					motivo: input.motivo,
				});
			} catch (error) {
				if (error instanceof OportunidadNoEncontradaError) {
					throw new ORPCError("NOT_FOUND", { message: error.message });
				}
				if (error instanceof OverrideNoAplicaError) {
					throw new ORPCError("BAD_REQUEST", { message: error.message });
				}
				if (error instanceof OverrideDpiInvalidoError) {
					throw new ORPCError("BAD_REQUEST", { message: error.message });
				}
				throw error;
			}
		}),
};
