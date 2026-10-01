/**
 * Módulo falso de `lib/acceso-caso-cobro` para los tests de routers y
 * servicios que NO prueban el permiso en sí: cada test decide con una función
 * si el usuario trabaja el crédito y, si hace falta, quién es su dueño en
 * cartera. El permiso real se prueba en `acceso-caso-cobro.test.ts`.
 *
 * Uso: `mock.module("../lib/acceso-caso-cobro", () => moduloAccesoFalso({...}))`
 * ANTES de importar el código bajo prueba. Trae todos los exports del módulo
 * real: un mock al que le falta uno rompe cualquier import que lo pida.
 */
import { ORPCError } from "@orpc/server";

const veTodo = (role: string | null | undefined) =>
	role === "admin" || role === "cobros_supervisor";

export function moduloAccesoFalso(opciones: {
	/** ¿El usuario de la sesión trabaja el crédito según cartera? */
	tieneAcceso: (userId: string) => boolean;
	/** Usuario del CRM dueño del crédito en cartera (para avisos). */
	duenoUsuario?: () => string | null;
	/** Simula que cartera no responde (solo la lectura estricta lanza). */
	carteraFalla?: () => boolean;
}) {
	const dueno = () => opciones.duenoUsuario?.() ?? null;
	return {
		assertAccesoCasoCobro: async (
			_casoCobroId: string,
			userId: string,
			userRole: string,
		) => {
			if (veTodo(userRole) || opciones.tieneAcceso(userId)) return;
			throw new ORPCError("NOT_FOUND", {
				message: "Caso de cobro no encontrado o sin acceso.",
			});
		},
		sifcosQueTrabaja: async (params: {
			userId: string;
			userRole: string | null | undefined;
			sifcos: readonly string[];
		}) =>
			veTodo(params.userRole)
				? null
				: new Set(opciones.tieneAcceso(params.userId) ? params.sifcos : []),
		usuarioTrabajaSifco: async (userId: string) => opciones.tieneAcceso(userId),
		asesoresDelUsuario: async () => new Set<number>(),
		asesoresQueTrabaja: () => new Set<number>(),
		duenosEnCarteraPorSifco: async () =>
			new Map<string, { asesorId: number; nombre: string }>(),
		usuariosDuenosPorSifco: async (sifcos: readonly string[]) => {
			const d = dueno();
			return new Map<string, string>(d ? sifcos.map((s) => [s, d]) : []);
		},
		usuarioDuenoEnCartera: async () => dueno(),
		usuarioDuenoEnCarteraEstricto: async () => {
			if (opciones.carteraFalla?.()) {
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"No se pudo confirmar en cartera el asesor de este crédito. Intente de nuevo en un momento.",
				});
			}
			return dueno();
		},
	};
}
