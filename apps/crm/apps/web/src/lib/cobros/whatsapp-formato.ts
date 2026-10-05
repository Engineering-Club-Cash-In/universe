/**
 * Formato de texto de WhatsApp para la vista previa de las plantillas de
 * cobros. Las plantillas se escriben con la sintaxis nativa de WhatsApp
 * (`*negrita*`) porque eso es lo que se manda por SimpleTech; acá solo la
 * interpretamos para mostrarla como la verá el cliente.
 *
 * Reglas que aplica WhatsApp y que replicamos:
 *  - El asterisco de apertura va pegado al texto (`*Hola`), no `* Hola`. Por
 *    eso los bullets `* BI: 5520029876` de las plantillas NO se vuelven
 *    negrita.
 *  - El de cierre también va pegado (`Hola*`).
 *  - La negrita no cruza saltos de línea.
 *  - Un asterisco sin pareja se muestra literal.
 */

export interface SegmentoWhatsapp {
	tipo: "texto" | "negrita";
	valor: string;
	/** Posición del segmento dentro del texto original (llave estable en UI). */
	inicio: number;
}

// `*x*` o `*x…y*` donde x/y no son espacio ni asterisco, sin `*` ni saltos de
// línea adentro.
const NEGRITA_RE = /\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g;

export function segmentarNegritasWhatsapp(texto: string): SegmentoWhatsapp[] {
	const segmentos: SegmentoWhatsapp[] = [];

	const agregar = (
		tipo: SegmentoWhatsapp["tipo"],
		valor: string,
		inicio: number,
	) => {
		if (!valor) return;
		const ultimo = segmentos.at(-1);
		if (ultimo && ultimo.tipo === tipo && tipo === "texto") {
			ultimo.valor += valor;
			return;
		}
		segmentos.push({ tipo, valor, inicio });
	};

	const lineas = texto.split("\n");
	let offset = 0;
	lineas.forEach((linea, i) => {
		let cursor = 0;
		for (const match of linea.matchAll(NEGRITA_RE)) {
			const indice = match.index ?? 0;
			agregar("texto", linea.slice(cursor, indice), offset + cursor);
			// match[0] incluye los asteriscos; match[1] es solo el contenido.
			agregar("negrita", match[1], offset + indice + 1);
			cursor = indice + match[0].length;
		}
		agregar("texto", linea.slice(cursor), offset + cursor);
		if (i < lineas.length - 1) {
			agregar("texto", "\n", offset + linea.length);
		}
		offset += linea.length + 1;
	});

	return segmentos;
}

/** true si el texto tiene al menos un tramo que WhatsApp mostraría en negrita. */
export function tieneNegritasWhatsapp(texto: string): boolean {
	return segmentarNegritasWhatsapp(texto).some((s) => s.tipo === "negrita");
}
