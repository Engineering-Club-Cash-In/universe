import { ORPCError } from "@orpc/server";
import { carteraBackClient } from "../services/cartera-back-client";
import { PERMISSIONS } from "./roles";

/**
 * COBROS-02 · "¿Este crédito es de quien lo está pidiendo?"
 *
 * La fuente autoritativa NO es el CRM sino CARTERA: el asesor asignado al
 * crédito. Un caso de cobros no sirve como autorización porque
 * `getDetallesCreditoCarteraBack` AUTO-CREA un caso con
 * `responsableCobros = quien consulta` cuando el crédito no tiene uno activo:
 * un asesor puede fabricarse el acceso consultando un SIFCO enumerable y
 * después pasar cualquier gate que mire el caso (hallazgo de Codex, PR #1570,
 * repetido en el #1591 para recuperación de vehículo y contratos).
 *
 * Se compara por `email_cash_in` contra el correo de login — el mismo puente
 * por correo que usa el resto del módulo (getConveniosListado, getAgendaDia),
 * porque `platform_users.email` está desactualizado para varios asesores.
 *
 * Admin y supervisor de cobros quedan fuera del chequeo: ellos sí operan sobre
 * cualquier crédito.
 *
 * Es una función PURA: acá solo vive la REGLA, para que no vuelva a haber dos
 * copias que se arreglan por separado.
 *
 * ⚠️ El crédito que se le pasa tiene que venir de una lectura SIN CACHE. Con
 * `CARTERA_BACK_ENABLE_CACHE=true` el cliente cachea `/credito` y una decisión
 * de autorización tomada sobre esa foto se equivoca en las dos direcciones: el
 * asesor viejo sigue pasando y el nuevo queda afuera hasta que expire (review de
 * Codex, P1). Si no tenés el crédito ya cargado, usá
 * `assertCreditoAsignadoEnCarteraPorSifco`, que lo garantiza por construcción.
 */
export function assertCreditoAsignadoEnCartera(params: {
	/** `credito.asesor?.emailCashIn` tal como viene de cartera-back. */
	emailAsesorCredito: string | null | undefined;
	/** Correo de la sesión, ya normalizado o no. */
	emailUsuario: string | null | undefined;
	userRole: string | null | undefined;
	/** Qué se estaba intentando hacer, para el mensaje de error. */
	accion: string;
}): void {
	if (PERMISSIONS.canViewAllCasosCobros(params.userRole ?? "")) return;

	const delCredito = params.emailAsesorCredito?.trim().toLowerCase();
	const delUsuario = params.emailUsuario?.trim().toLowerCase();

	if (!delCredito || !delUsuario || delCredito !== delUsuario) {
		throw new ORPCError("FORBIDDEN", {
			message: `Este crédito no está asignado a vos en cartera; no podés ${params.accion}.`,
		});
	}
}

/**
 * Igual que `assertCreditoAsignadoEnCartera` pero trayendo el crédito por su
 * SIFCO, SIEMPRE sin cache. Existe para que la lectura correcta no dependa de
 * que quien escribe el guard se acuerde del segundo argumento de `getCredito`
 * —que por defecto SÍ cachea— y por eso el nombre dice para qué es.
 *
 * A quien ve toda la cartera (admin / supervisor de cobros) ni siquiera se le
 * consulta cartera: la regla ya lo deja pasar, así que se ahorra la llamada.
 */
export async function assertCreditoAsignadoEnCarteraPorSifco(params: {
	numeroSifco: string;
	emailUsuario: string | null | undefined;
	userRole: string | null | undefined;
	accion: string;
}): Promise<void> {
	if (PERMISSIONS.canViewAllCasosCobros(params.userRole ?? "")) return;

	const credito = await carteraBackClient.getCredito(params.numeroSifco, false);
	assertCreditoAsignadoEnCartera({
		emailAsesorCredito: credito.asesor?.emailCashIn,
		emailUsuario: params.emailUsuario,
		userRole: params.userRole,
		accion: params.accion,
	});
}
