/**
 * Marca de un contrato que jurídico subió a mano ("Subir contrato") en vez de
 * generarlo desde la plantilla.
 *
 * Importa para quien lo manda a firmar: un documento armado por una persona
 * puede traer las líneas de firma en otro orden o en otro lugar que la
 * plantilla (los de sociedad, por ejemplo, se suben como si fueran de venta).
 * El generador ubica las firmas igual, pero conviene que alguien mire el
 * documento antes de que le llegue al cliente. Con la marca, la ficha lo dice.
 *
 * Va dentro de `apiResponse` y no en una columna propia para no sumar otra
 * migración. Al regenerar (mismo documento, enlaces nuevos) se copia a la fila
 * nueva: sigue siendo el mismo documento subido a mano.
 *
 * OJO: lo importa también el navegador (las fichas de jurídico y de análisis),
 * así que no puede leer `process.env`.
 */
export function conMarcaDeSubidoAMano<T extends object>(
	apiResponse: T,
): T & { subidoAMano: true } {
	return { ...apiResponse, subidoAMano: true };
}

export function fueSubidoAMano(apiResponse: unknown): boolean {
	return (
		typeof apiResponse === "object" &&
		apiResponse !== null &&
		(apiResponse as { subidoAMano?: unknown }).subidoAMano === true
	);
}
