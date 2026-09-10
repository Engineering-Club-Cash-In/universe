import { ORPCError } from "@orpc/server";
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
 * Es una función PURA: el crédito lo trae cada caller (unos ya lo tienen
 * cargado y otros necesitan la versión sin cache), acá solo vive la REGLA, para
 * que no vuelva a haber dos copias que se arreglan por separado.
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
