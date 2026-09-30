/**
 * Contratos subidos a mano que no salieron a firma, y los que se vincularon
 * después con un documento armado directo en WeeTrust.
 *
 * Cuando jurídico sube un PDF hecho por fuera, el generador busca las líneas de
 * firma donde las declara el layout de ese tipo. Si no las encuentra, antes se
 * rechazaba la subida y el contrato terminaba saliendo por fuera del sistema:
 * alguien lo subía a WeeTrust, acomodaba las firmas a mano, y el CRM nunca se
 * enteraba de ese documento. Ahora:
 *
 * 1. El contrato **se guarda igual**, con su PDF, marcado `faltaVincular`. No
 *    tiene documento en WeeTrust ni enlaces.
 * 2. Se le avisa a quien le da seguimiento a la firma (análisis en ventas,
 *    inversiones en sus contratos): baja el PDF, lo sube a WeeTrust, pone las
 *    firmas y lo manda.
 * 3. Pega en la ficha un enlace de ese documento. El CRM lee el documento en
 *    WeeTrust, empareja a los firmantes por correo y el contrato queda como
 *    cualquier otro, marcado `vinculadoDesdeWeeTrust`.
 *
 * Vincular también sirve sobre un contrato que SÍ salió a firma y todavía no
 * está firmado, cuando las firmas quedaron mal puestas o hay que mandar otro
 * documento: el de WeeTrust que tenía se borra y queda el que se pegó.
 *
 * Que se guarde sin enviar sólo pasa en la subida a mano. Lo que sale de nuestras plantillas siempre
 * trae las líneas donde van: si ahí no calzan, es un error y se trata como tal.
 *
 * Las marcas van dentro de `apiResponse`, igual que `subidoAMano`, para no
 * sumar otra migración.
 *
 * OJO: lo importa también el navegador, así que no puede leer `process.env`.
 */

/** El contrato está guardado pero no salió a firma. */
export interface FaltaVincular {
	/** Por qué no se pudieron ubicar las firmas, como lo dijo el generador. */
	motivo: string;
	/** ISO. */
	desde: string;
}

export function conMarcaDeFaltaVincular<T extends object>(
	apiResponse: T,
	marca: FaltaVincular,
): T & { faltaVincular: FaltaVincular } {
	return { ...apiResponse, faltaVincular: marca };
}

export function faltaVincular(apiResponse: unknown): FaltaVincular | null {
	if (typeof apiResponse !== "object" || apiResponse === null) return null;
	const marca = (apiResponse as { faltaVincular?: unknown }).faltaVincular;
	if (typeof marca !== "object" || marca === null) return null;
	const { motivo, desde } = marca as Partial<FaltaVincular>;
	if (typeof desde !== "string") return null;
	return { motivo: typeof motivo === "string" ? motivo : "", desde };
}

/**
 * El documento de firma no lo emitió el CRM: lo armó una persona en WeeTrust.
 *
 * Importa para dos cosas. Las firmas están donde esa persona las puso, así que
 * sus enlaces se renuevan sobre el mismo documento (reemitirlo desde acá las
 * volvería a buscar y no las encontraría). Y la verificación de identidad es la
 * que esa persona configuró: WeeTrust no le dice a nadie cuál fue, así que el
 * sistema no puede dar fe de que se haya pedido la que correspondía.
 */
export interface VinculadoDesdeWeeTrust {
	/** Quién lo vinculó. */
	por: string;
	/** ISO. */
	cuando: string;
	/** El documento de WeeTrust que tenía antes y se borró, si tenía uno. */
	documentoAnterior?: string;
}

/** Cambia la marca de "falta vincular" por la de "vinculado". */
export function conMarcaDeVinculado(
	apiResponse: unknown,
	marca: VinculadoDesdeWeeTrust,
): Record<string, unknown> & {
	vinculadoDesdeWeeTrust: VinculadoDesdeWeeTrust;
} {
	const base =
		typeof apiResponse === "object" && apiResponse !== null
			? { ...(apiResponse as Record<string, unknown>) }
			: {};
	delete base.faltaVincular;
	return { ...base, vinculadoDesdeWeeTrust: marca };
}

export function vinculadoDesdeWeeTrust(
	apiResponse: unknown,
): VinculadoDesdeWeeTrust | null {
	if (typeof apiResponse !== "object" || apiResponse === null) return null;
	const marca = (apiResponse as { vinculadoDesdeWeeTrust?: unknown })
		.vinculadoDesdeWeeTrust;
	if (typeof marca !== "object" || marca === null) return null;
	const { por, cuando, documentoAnterior } =
		marca as Partial<VinculadoDesdeWeeTrust>;
	if (typeof por !== "string" || typeof cuando !== "string") return null;
	return {
		por,
		cuando,
		...(typeof documentoAnterior === "string" ? { documentoAnterior } : {}),
	};
}

/** Los ids de WeeTrust: 24 caracteres hexadecimales. */
const ID_DE_WEETRUST = /^[0-9a-f]{24}$/i;

/**
 * Saca el id del documento de lo que pega la persona.
 *
 * Sirve cualquiera de los enlaces que WeeTrust da de un documento, porque
 * todos lo llevan adelante, o el id pelado:
 *
 * - de firma: `https://app.weetrust.mx/signatory/{documento}/{firmante}/…`
 * - de observador: `https://app.weetrust.mx/observer/{documento}/{observador}/…`
 *
 * Devuelve null si no reconoce nada: es preferible pedir otro enlace a
 * adivinar cuál de los ids de una dirección desconocida es el del documento.
 */
export function documentIdDeWeeTrust(pegado: string): string | null {
	const texto = pegado.trim();
	if (ID_DE_WEETRUST.test(texto)) return texto.toLowerCase();

	const conocido = texto.match(
		/\/(?:signatory|observer)\/([0-9a-f]{24})(?=[/?#]|$)/i,
	);
	if (conocido?.[1]) return conocido[1].toLowerCase();

	// Otra dirección de WeeTrust (la del documento en su panel): sólo si trae un
	// único id, que entonces es el del documento.
	let url: URL;
	try {
		url = new URL(texto);
	} catch {
		return null;
	}
	if (!/(^|\.)weetrust\.(mx|com\.mx)$/i.test(url.hostname)) return null;
	const ids = [
		...url.pathname.split("/"),
		...[...url.searchParams.values()],
	].filter((parte) => ID_DE_WEETRUST.test(parte));
	const distintos = [...new Set(ids.map((id) => id.toLowerCase()))];
	return distintos.length === 1 ? (distintos[0] ?? null) : null;
}

/** Cómo se lee cada rol en los textos de vincular. */
export const ROL_EN_PALABRAS: Record<string, string> = {
	TITULAR: "Titular",
	COFIRMANTE: "Codeudor",
	REP_LEGAL: "Representante legal",
	REP_LEGAL_RDBE: "Representante legal (RDBE)",
	VENDEDOR: "Vendedor",
};
