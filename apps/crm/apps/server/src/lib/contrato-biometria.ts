/**
 * Marca de un contrato que se cerró sin que la verificación facial pasara.
 *
 * WeeTrust no cierra un documento cuando la identificación de quien firma sale
 * inválida, por más que la firma esté puesta. "Omitir" salta esa validación
 * para que el documento cierre, así que el contrato vale con una identidad que
 * nadie verificó: tiene que quedar dicho en la ficha y para siempre, no en un
 * log que nadie va a leer.
 *
 * Va dentro de `apiResponse`, igual que la marca de subido a mano, para no
 * sumar otra migración.
 *
 * OJO: lo lee también el navegador, así que no puede tocar `process.env`.
 */
export interface BiometriaOmitida {
	/** Quién decidió omitirla. */
	por: string;
	/** ISO, para que la ficha la muestre en la zona de quien mira. */
	cuando: string;
	/** De quién era la verificación que no pasó. */
	firmantes: string[];
}

export function conMarcaDeBiometriaOmitida<T extends object>(
	apiResponse: T,
	omitida: BiometriaOmitida,
): T & { biometriaOmitida: BiometriaOmitida } {
	return { ...apiResponse, biometriaOmitida: omitida };
}

export function biometriaOmitida(
	apiResponse: unknown,
): BiometriaOmitida | null {
	if (typeof apiResponse !== "object" || apiResponse === null) return null;
	const marca = (apiResponse as { biometriaOmitida?: unknown })
		.biometriaOmitida;
	if (typeof marca !== "object" || marca === null) return null;
	const { por, cuando, firmantes } = marca as Partial<BiometriaOmitida>;
	if (typeof por !== "string" || typeof cuando !== "string") return null;
	return {
		por,
		cuando,
		firmantes: Array.isArray(firmantes)
			? firmantes.filter((f) => typeof f === "string")
			: [],
	};
}
