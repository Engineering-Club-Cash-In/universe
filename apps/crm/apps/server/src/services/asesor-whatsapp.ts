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
	return (
		(await carteraBackClient.getResumenCredito(numeroSifco))?.asesor ?? null
	);
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

export function construirCierreAsesor(asesor: ContactoAsesor | null): string {
	return asesor
		? `Cualquier duda, llama a tu asesor ${asesor.nombre} al ${asesor.telefono}.`
		: "Cualquier duda, comunícate con tu asesor.";
}
