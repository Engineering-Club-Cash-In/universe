/**
 * Wialon / La Legión GPS Router
 *
 * Módulo independiente para exponer los endpoints de telemática y rastreo GPS
 * hacia el frontend y servicios del CRM vía ORPC.
 *
 * Sigue el mismo patrón desacoplado que pagaloSupervisionRouter y recuperacionVehiculoRouter
 * para evitar el límite de TypeScript (TS7056) en la inferencia de tipos hacia apps/web.
 */

import { ORPCError } from "@orpc/server";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { getWialonClient } from "../services/wialon/wialon-client";
import {
	createLocatorLinkInputSchema,
	deleteLocatorLinkInputSchema,
	getUnitDetailInputSchema,
	getUnitsStatusInputSchema,
	searchUnitsInputSchema,
	WialonClientError,
} from "../services/wialon/wialon-types";

export function mapWialonErrorToOrpc(error: unknown): never {
	if (error instanceof WialonClientError) {
		if (error.code === "WIALON_AUTH_REQUIRED") {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"Token de Wialon no configurado en el servidor (WIALON_TOKEN).",
			});
		}
		if (error.code === "WIALON_INVALID_SESSION") {
			throw new ORPCError("BAD_GATEWAY", {
				message:
					"Fallo de autenticación con el proveedor de Wialon: credenciales upstream no válidas o expiradas.",
			});
		}
		if (error.code === "WIALON_TIMEOUT") {
			throw new ORPCError("GATEWAY_TIMEOUT", {
				message: "La solicitud a la API de Wialon superó el tiempo límite.",
			});
		}
		if (error.code === "WIALON_NETWORK_ERROR") {
			throw new ORPCError("BAD_GATEWAY", {
				message: `Error al conectar con la API de Wialon: ${error.message}`,
			});
		}
		if (error.code === "WIALON_INVALID_RESPONSE") {
			throw new ORPCError("BAD_GATEWAY", {
				message: `Respuesta inválida de Wialon: ${error.message}`,
			});
		}
		if (error.code === "WIALON_API_ERROR") {
			const upstreamFaults = [5, 8, 9, 10, 11, 14]; // 5=ejecución, 8=credenciales inválidas, 9=servidor ocupado, 10=límite peticiones, 11=DB no disponible, 14=facturación
			if (
				typeof error.wialonErrorCode === "number" &&
				upstreamFaults.includes(error.wialonErrorCode)
			) {
				const isAuthFault = error.wialonErrorCode === 8;
				throw new ORPCError("BAD_GATEWAY", {
					message: isAuthFault
						? `Fallo de autenticación con el proveedor de Wialon (credenciales o token inválido): ${error.message}`
						: `Fallo del servicio de Wialon (código ${error.wialonErrorCode}): ${error.message}`,
				});
			}
			if (error.wialonErrorCode === 7) {
				throw new ORPCError("FORBIDDEN", {
					message: `Acceso denegado o permisos insuficientes en Wialon: ${error.message}`,
				});
			}
			throw new ORPCError("BAD_REQUEST", {
				message: error.message,
			});
		}
		throw new ORPCError("BAD_REQUEST", {
			message: error.message,
		});
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message:
			error instanceof Error
				? error.message
				: "Error interno procesando solicitud de Wialon",
	});
}

export const wialonRouter = {
	/**
	 * Busca y lista las unidades de rastreo GPS (svc: core/search_items)
	 */
	getWialonUnits: cobrosProcedure
		.input(searchUnitsInputSchema.optional())
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				const result = await client.searchUnits(input);
				return {
					total: result.totalItemsCount,
					from: result.indexFrom,
					to: result.indexTo,
					items: result.items,
				};
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Obtiene el estado telemático consolidado de una o más unidades en tiempo real:
	 * kilometraje, horas de motor, velocidad, coordenadas y sensores formateados (svc: unit/calc_last)
	 */
	getWialonUnitsStatus: cobrosProcedure
		.input(getUnitsStatusInputSchema)
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				return await client.getUnitsStatus(input.unitIds);
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Consulta los detalles completos y mensajes crudos de una unidad (svc: core/search_item)
	 */
	getWialonUnitDetail: cobrosProcedure
		.input(getUnitDetailInputSchema)
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				return await client.getUnitDetail(input.unitId, input.flags);
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Genera un enlace público temporal de rastreo en vivo (Locator) (svc: token/update)
	 * Restringido a supervisores de cobros y administradores por privacidad y seguridad.
	 */
	createWialonTrackingLink: cobrosSupervisorProcedure
		.input(createLocatorLinkInputSchema)
		.handler(async ({ input, context }) => {
			try {
				const client = getWialonClient();
				const result = await client.createLocatorLink(input);
				console.info("WIALON_LOCATOR_LINK_CREATED", {
					userId: context.userId,
					userEmail: context.user?.email || context.session?.user?.email,
					unitId: result.unitId,
					hashPrefix: `${result.hash.slice(0, 8)}...`,
					durationSeconds: result.durationSeconds,
					expiresAt: result.expiresAt,
					timestamp: new Date().toISOString(),
				});
				return result;
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Revoca o cancela anticipadamente un enlace de rastreo en vivo (svc: token/update con callMode: delete)
	 * Restringido a supervisores de cobros y administradores.
	 */
	deleteWialonTrackingLink: cobrosSupervisorProcedure
		.input(deleteLocatorLinkInputSchema)
		.handler(async ({ input, context }) => {
			try {
				const client = getWialonClient();
				const result = await client.deleteLocatorLink(input.hash);
				console.info("WIALON_LOCATOR_LINK_DELETED", {
					userId: context.userId,
					userEmail: context.user?.email || context.session?.user?.email,
					hashPrefix: `${input.hash.slice(0, 8)}...`,
					timestamp: new Date().toISOString(),
				});
				return result;
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Diagnóstico de conexión y estado de sesión con Wialon
	 */
	getWialonConnectionStatus: cobrosProcedure.handler(async () => {
		try {
			const client = getWialonClient();
			const health = await client.checkHealth(false);
			const session = client.getCachedSession();
			return {
				connected: health.status === "connected",
				user: health.user || session?.user || null,
				expiresAt: session?.expiresAt ? new Date(session.expiresAt) : null,
			};
		} catch (error) {
			throw mapWialonErrorToOrpc(error);
		}
	}),
};
