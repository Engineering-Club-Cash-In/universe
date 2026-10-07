/**
 * Contacto del asesor para cerrar los mensajes automáticos de WhatsApp
 * (recibo de pago, cuenta Nexa). Cartera suele mandar el asesor junto con el
 * evento; si no viene completo, se pide a cartera con el mismo `/credito` que
 * usa el resto del CRM.
 */

import { carteraBackClient } from "./cartera-back-client";

export interface ContactoAsesor {
	nombre: string;
	telefono: string;
}

export type ObtenerAsesor = (
	numeroSifco: string,
) => Promise<{ nombre: string | null; telefono: string | null } | null>;

function contactoCompleto(
	valor:
		| { nombre?: string | null; telefono?: string | null }
		| null
		| undefined,
): ContactoAsesor | null {
	const nombre = valor?.nombre?.trim() ?? "";
	const telefono = valor?.telefono?.trim() ?? "";
	return nombre && telefono ? { nombre, telefono } : null;
}

export async function obtenerAsesorCartera(
	numeroSifco: string,
): Promise<{ nombre: string | null; telefono: string | null } | null> {
	const credito = await carteraBackClient.getCredito(numeroSifco);
	if (!credito?.asesor) return null;
	return {
		nombre: credito.asesor.nombre ?? null,
		telefono: credito.asesor.telefono ?? null,
	};
}

export async function resolverContactoAsesor(
	numeroSifco: string,
	preferido: { nombre?: string | null; telefono?: string | null } | null,
	obtener: ObtenerAsesor = obtenerAsesorCartera,
): Promise<ContactoAsesor | null> {
	const directo = contactoCompleto(preferido);
	if (directo) return directo;

	try {
		return contactoCompleto(await obtener(numeroSifco));
	} catch (error) {
		const mensaje = error instanceof Error ? error.message : String(error);
		console.warn(
			`[AsesorWhatsapp] No se pudo resolver asesor para ${numeroSifco}: ${mensaje}`,
		);
		return null;
	}
}

/** Cierre formal; sin teléfono no se escribe "al ." (pide el nombre y el número). */
export function construirCierreAsesor(asesor: ContactoAsesor | null): string {
	return asesor
		? `Ante cualquier consulta, comuníquese con su asesor ${asesor.nombre} al ${asesor.telefono}.`
		: "Ante cualquier consulta, comuníquese con su asesor.";
}
