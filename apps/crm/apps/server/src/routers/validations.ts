import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import { crmProcedure } from "../lib/orpc";
import {
	puedeAccederDetalleBuro,
	puedeMarcarValidacionManualDetalleBuro,
	puedeReejecutarDetalleBuro,
} from "../lib/permiso-detalle-buro";
import { PERMISSIONS } from "../lib/roles";
import {
	CofirmanteNoEncontradoError,
	ejecutarBuroAlVeinteSiCorresponde,
	ejecutarBuroCofirmantes,
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
 * Los cofirmantes pasan solo por Buró, con las mismas reglas que el titular.
 *
 * El detalle sigue visible durante toda la oportunidad. Re-ejecutar solo se
 * permite al 20% y, excepcionalmente, al 30% tras revalidación. Un asesor solo ve las suyas.
 */
async function verificarAccesoDetalleBuro({
	opportunityId,
	userId,
	userRole,
	reEjecutar = false,
	validacionManualTipo,
}: {
	opportunityId: string;
	userId: string;
	userRole: string;
	reEjecutar?: boolean;
	validacionManualTipo?: "buro" | "renap";
}): Promise<void> {
	const [oportunidad] = await db
		.select({
			assignedTo: opportunities.assignedTo,
			status: opportunities.status,
			porcentaje: salesStages.closurePercentage,
			buroRevalidacionAl30: opportunities.buroRevalidacionAl30,
		})
		.from(opportunities)
		.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);
	if (!oportunidad) {
		throw new ORPCError("NOT_FOUND", { message: "Oportunidad no encontrada" });
	}
	const parametros = {
		userRole,
		userId,
		assignedTo: oportunidad.assignedTo,
	};
	const expediente = {
		...parametros,
		porcentaje: oportunidad.porcentaje,
		status: oportunidad.status,
		buroRevalidacionAl30: oportunidad.buroRevalidacionAl30,
	};
	const permitido = validacionManualTipo
		? puedeMarcarValidacionManualDetalleBuro({
				...expediente,
				tipo: validacionManualTipo,
			})
		: reEjecutar
			? puedeReejecutarDetalleBuro(expediente)
			: puedeAccederDetalleBuro(parametros);
	if (!permitido) {
		throw new ORPCError("FORBIDDEN", {
			message: "No tienes acceso al detalle de Buró de esta oportunidad",
		});
	}
}

export const validationsRouter = {
	ejecutarValidacionesRenapBuro: crmProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				reusarVigente: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			await verificarAccesoDetalleBuro({
				opportunityId: input.opportunityId,
				userId: context.userId,
				userRole: context.userRole,
				reEjecutar: true,
			});
			const estado = await getValidaciones({
				opportunityId: input.opportunityId,
			});
			if (estado.faltaConsentimiento) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Carga la cláusula de consentimiento antes de consultar Infornet",
				});
			}
			const parametros = {
				opportunityId: input.opportunityId,
				userId: context.userId,
				reusarVigente: input.reusarVigente,
			};

			const [titular, cofirmantes] = await Promise.all([
				ejecutarValidaciones(parametros),
				ejecutarBuroCofirmantes(parametros),
			]);

			return { ...titular, cofirmantes };
		}),

	/** Estado operativo para ventas; no expone score, alertas ni motivos del buró. */
	getResumenBuroOportunidad: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [oportunidad] = await db
				.select({
					assignedTo: opportunities.assignedTo,
					status: opportunities.status,
					porcentaje: salesStages.closurePercentage,
					buroRevalidacionAl30: opportunities.buroRevalidacionAl30,
					titularPrimerNombre: leads.firstName,
					titularSegundoNombre: leads.middleName,
					titularPrimerApellido: leads.lastName,
					titularSegundoApellido: leads.secondLastName,
				})
				.from(opportunities)
				.innerJoin(salesStages, eq(opportunities.stageId, salesStages.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);
			if (!oportunidad) {
				throw new ORPCError("NOT_FOUND", {
					message: "Oportunidad no encontrada",
				});
			}
			if (
				!puedeAccederDetalleBuro({
					userRole: context.userRole,
					userId: context.userId,
					assignedTo: oportunidad.assignedTo,
				})
			) {
				throw new ORPCError("FORBIDDEN", {
					message: "No tienes acceso al Buró de esta oportunidad",
				});
			}

			const estado = await getValidaciones({
				opportunityId: input.opportunityId,
			});
			const resumen = (
				buro: typeof estado.buro,
				vigente: boolean,
				desactualizado: boolean,
			) => {
				if (!buro) return "pendiente" as const;
				if (desactualizado)
					return oportunidad.porcentaje === 20
						? ("pendiente" as const)
						: ("desactualizado" as const);
				if (buro.estado === "error") return "error" as const;
				if (!vigente)
					return oportunidad.porcentaje === 20
						? ("pendiente" as const)
						: ("vencido" as const);
				return "completado" as const;
			};
			const resultadoVisible = (
				buro: typeof estado.buro,
				vigente: boolean,
				desactualizado: boolean,
			) =>
				!["completado", "error"].includes(
					resumen(buro, vigente, desactualizado),
				)
					? null
					: (buro?.estado ?? null);

			return {
				permitirReejecucion: puedeReejecutarDetalleBuro({
					userRole: context.userRole,
					userId: context.userId,
					assignedTo: oportunidad.assignedTo,
					porcentaje: oportunidad.porcentaje,
					status: oportunidad.status,
					buroRevalidacionAl30: oportunidad.buroRevalidacionAl30,
				}),
				permitirValidacionManualBuro: puedeMarcarValidacionManualDetalleBuro({
					userRole: context.userRole,
					userId: context.userId,
					assignedTo: oportunidad.assignedTo,
					porcentaje: oportunidad.porcentaje,
					status: oportunidad.status,
					buroRevalidacionAl30: oportunidad.buroRevalidacionAl30,
					tipo: "buro",
				}),
				exento: estado.exento,
				faltaDpi: estado.faltaDpi,
				faltaConsentimiento: estado.faltaConsentimiento,
				titularNombre:
					[
						oportunidad.titularPrimerNombre,
						oportunidad.titularSegundoNombre,
						oportunidad.titularPrimerApellido,
						oportunidad.titularSegundoApellido,
					]
						.filter(Boolean)
						.join(" ") || null,
				titular: resumen(
					estado.buro,
					estado.buroVigente,
					estado.buroDesactualizado,
				),
				titularResultado: resultadoVisible(
					estado.buro,
					estado.buroVigente,
					estado.buroDesactualizado,
				),
				cofirmantes: estado.cofirmantes.map((cofirmante) => ({
					id: cofirmante.coDebtorId,
					nombre: cofirmante.nombre,
					estado: resumen(
						cofirmante.buro,
						cofirmante.buroVigente,
						cofirmante.buroDesactualizado,
					),
					resultado: resultadoVisible(
						cofirmante.buro,
						cofirmante.buroVigente,
						cofirmante.buroDesactualizado,
					),
				})),
			};
		}),

	/** Recupera una consulta pendiente desde una acción explícita del cliente. */
	asegurarBuroOportunidad: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await verificarAccesoDetalleBuro({
				opportunityId: input.opportunityId,
				userId: context.userId,
				userRole: context.userRole,
				reEjecutar: true,
			});
			const estado = await getValidaciones({
				opportunityId: input.opportunityId,
			});
			if (estado.faltaConsentimiento || estado.exento)
				return { success: false };
			await ejecutarBuroAlVeinteSiCorresponde({
				opportunityId: input.opportunityId,
				userId: context.userId,
			});
			return { success: true };
		}),

	getValidacionesOportunidad: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await verificarAccesoDetalleBuro({
				opportunityId: input.opportunityId,
				userId: context.userId,
				userRole: context.userRole,
			});
			try {
				const estado = await getValidaciones({
					opportunityId: input.opportunityId,
				});
				if (PERMISSIONS.canAccessAnalysis(context.userRole)) return estado;
				return {
					...estado,
					renap: null,
					detalleRenap: null,
					overrideRenap: null,
					renapDesactualizado: false,
					validaciones: estado.validaciones.filter((v) => v.tipo === "buro"),
				};
			} catch (error) {
				if (error instanceof OportunidadNoEncontradaError) {
					throw new ORPCError("NOT_FOUND", { message: error.message });
				}
				throw error;
			}
		}),

	/**
	 * Override manual: el usuario verificó a mano en el portal de la fuente
	 * que falló (Infornet o Centinela/RENAP) que el cliente está en orden.
	 * Solo aplica si la última validación de ese tipo está en `estado:'error'`.
	 */
	marcarValidacionManual: crmProcedure
		.meta({ audit: { entity: "opportunity", action: "override_validation" } })
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				tipo: z.enum(["buro", "renap"]),
				/** Ausente = titular */
				coDebtorId: z.string().uuid().optional(),
				motivo: z
					.string()
					.trim()
					.min(10, "El motivo debe tener al menos 10 caracteres"),
			}),
		)
		.handler(async ({ input, context }) => {
			await verificarAccesoDetalleBuro({
				opportunityId: input.opportunityId,
				userId: context.userId,
				userRole: context.userRole,
				validacionManualTipo: input.tipo,
			});
			const estado = await getValidaciones({
				opportunityId: input.opportunityId,
			});
			if (estado.faltaConsentimiento) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Carga la cláusula de consentimiento antes de validar Buró manualmente",
				});
			}

			if (input.coDebtorId && input.tipo === "renap") {
				throw new ORPCError("BAD_REQUEST", {
					message: "Los cofirmantes solo se validan en Buró, no en RENAP",
				});
			}

			try {
				// Bajo suplantación, `context.userId` es el usuario suplantado, no
				// el admin que la inició (Better Auth deja a este último en la
				// sesión, no en el usuario) — mismo criterio que ya usa
				// `auditMiddleware` para no atribuirle el override a la persona
				// equivocada en un rastro de auditoría sensible.
				const actorId =
					context.session?.session?.impersonatedBy ?? context.userId;

				const parametros = {
					opportunityId: input.opportunityId,
					userId: actorId,
					motivo: input.motivo,
				};

				return input.tipo === "buro"
					? await marcarValidacionBuroManual({
							...parametros,
							coDebtorId: input.coDebtorId,
						})
					: await marcarValidacionRenapManual(parametros);
			} catch (error) {
				if (
					error instanceof OportunidadNoEncontradaError ||
					error instanceof CofirmanteNoEncontradoError
				) {
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
