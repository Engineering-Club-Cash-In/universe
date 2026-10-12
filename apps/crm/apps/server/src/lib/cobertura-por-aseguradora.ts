/**
 * Qué carta de cobertura corresponde a la aseguradora de la venta.
 *
 * Universales tiene dos (placas particulares y comerciales, y jurídico elige
 * por las placas); G&T tiene una. Las que no corresponden no se esconden: se
 * dejan deshabilitadas en el asistente, para que jurídico vea cuál va a salir.
 *
 * Lo importa también el navegador: no puede leer `process.env` ni la base.
 */
import type { InsuranceProvider } from "./insurance-selection";

export const COBERTURAS_POR_ASEGURADORA: Record<
	InsuranceProvider,
	readonly string[]
> = {
	universales: ["cobertura_inrexsa", "cobertura_inrexsa_comercial"],
	gyt: ["cobertura_gyt"],
};

const NOMBRE_ASEGURADORA: Record<InsuranceProvider, string> = {
	universales: "Seguros Universales",
	gyt: "Seguros G&T",
};

/**
 * Lo que guarda la cotización, normalizado. Cualquier otro valor es Universales,
 * igual que en el cierre y en la pantalla de la cotización.
 */
export function normalizarAseguradora(
	valor: string | null | undefined,
): InsuranceProvider {
	return valor?.trim().toLowerCase() === "gyt" ? "gyt" : "universales";
}

/**
 * Las coberturas de la otra aseguradora, con el motivo para mostrar junto a
 * la opción deshabilitada.
 */
export function coberturasQueNoCorresponden(
	aseguradora: InsuranceProvider,
): Record<string, string> {
	const motivo = `La cotización es con ${NOMBRE_ASEGURADORA[aseguradora]}`;
	const deshabilitadas: Record<string, string> = {};
	for (const [otra, coberturas] of Object.entries(COBERTURAS_POR_ASEGURADORA)) {
		if (otra === aseguradora) continue;
		for (const cobertura of coberturas) deshabilitadas[cobertura] = motivo;
	}
	return deshabilitadas;
}

/** Si el tipo es una carta de cobertura, de cualquier aseguradora. */
export function esCartaDeCobertura(contractType: string): boolean {
	return Object.values(COBERTURAS_POR_ASEGURADORA).some((coberturas) =>
		coberturas.includes(contractType),
	);
}
