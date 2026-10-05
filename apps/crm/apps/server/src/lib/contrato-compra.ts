/**
 * De qué compra es un contrato de inversión: la fecha en que se aceptó.
 *
 * La batería guarda sólo la última aceptación: otra compra sobre los mismos
 * créditos reusa la batería y le pisa `acceptedAt`. Con dos compras alcanzaba
 * comparar contra esa fecha ("antes" o "desde"), pero con tres las dos
 * anteriores quedaban juntas, como si fueran una sola compra. Así que cada
 * contrato se lleva la suya al guardarse, como las otras marcas que viven en
 * la respuesta del generador (subido a mano, verificación omitida).
 *
 * Sin `process.env`: la ficha la lee desde el navegador.
 */
export function conMarcaDeCompra<T extends object>(
	apiResponse: T,
	aceptadaEn: Date,
): T & { compraAceptadaEn: string } {
	return { ...apiResponse, compraAceptadaEn: aceptadaEn.toISOString() };
}

/** La aceptación de la compra del contrato, o null en los de antes de la marca. */
export function compraDelContrato(apiResponse: unknown): string | null {
	if (typeof apiResponse !== "object" || apiResponse === null) return null;
	const valor = (apiResponse as { compraAceptadaEn?: unknown })
		.compraAceptadaEn;
	return typeof valor === "string" && !Number.isNaN(Date.parse(valor))
		? valor
		: null;
}
