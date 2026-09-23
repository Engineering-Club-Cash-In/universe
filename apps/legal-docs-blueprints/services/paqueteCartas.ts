/**
 * Las cartas de una venta, unidas en un solo documento para firmar.
 *
 * A los clientes les llegaban once enlaces y no los firmaban. Las cartas son lo
 * que se puede juntar: sólo las firman el cliente y sus codeudores, y casi
 * todas son de una hoja. Unidas, cada persona recibe un enlace para todas en
 * vez de uno por carta.
 *
 * El problema es dónde van las firmas. Cada carta tiene su propia línea
 * ("F)____", "f)____", "Firma:____") y sus páginas no miden lo mismo (la de
 * cheques es oficio, otras son A4 o carta, la cobertura es más larga). Buscar
 * un solo patrón en el PDF unido no encontraría la mitad, y medir con el tamaño
 * de otra página correría las firmas.
 *
 * Por eso las firmas se ubican **carta por carta**, con el patrón y el layout
 * que ya tiene declarado cada una, sobre sus propias páginas. Unir no cambia la
 * geometría de ninguna página: lo único que cambia es su número, así que a cada
 * posición se le suma cuántas páginas había antes de su carta.
 *
 * Para poder repetirlo al reemitir (que parte del PDF ya unido), el paquete
 * lleva escrito en sus metadatos qué cartas trae y cuántas páginas ocupa cada
 * una. Así el PDF que se guardó en R2 alcanza para volver a ubicar todo.
 */
import { PDFDocument } from "pdf-lib";
import {
	type ComposicionDelPaquete,
	type ContractSigner,
	ContractType,
} from "../types/contract";
import { esCartaUnificable, SignatureLayoutError } from "./signaturePatterns";
import {
	WeeTrustService,
	type WeeTrustSignaturePosition,
} from "./WeeTrustService";

/**
 * Primera palabra clave de un paquete. Las siguientes son `tipo:páginas`, una
 * por carta, en orden. Palabras clave y no JSON: es lo que cualquiera ve en las
 * propiedades del PDF, y así se entiende sin herramientas.
 */
const MARCA = ContractType.PAQUETE_CARTAS;

/** Una carta ya convertida a PDF, lista para unirse. */
export interface CartaEnPdf {
	contractType: ContractType;
	label: string;
	pdf: Buffer;
}

/**
 * Une las cartas en un solo PDF, en el orden recibido.
 *
 * Las páginas se copian tal cual, con su tamaño original: una carta en oficio
 * sigue en oficio. Devuelve además la composición, que es lo que dice qué
 * páginas son de qué carta.
 */
export async function unirCartas(
	cartas: CartaEnPdf[],
): Promise<{ pdf: Buffer; composicion: ComposicionDelPaquete }> {
	if (cartas.length === 0) {
		throw new SignatureLayoutError("No hay cartas que unir.");
	}

	const noSonCartas = cartas
		.filter((c) => !esCartaUnificable(c.contractType))
		.map((c) => c.contractType);
	if (noSonCartas.length > 0) {
		throw new SignatureLayoutError(
			`Sólo las cartas se unen en un documento; esto no lo es: ${noSonCartas.join(", ")}.`,
		);
	}

	const unido = await PDFDocument.create();
	const composicion: ComposicionDelPaquete = [];

	for (const carta of cartas) {
		const origen = await PDFDocument.load(carta.pdf);
		const paginas = await unido.copyPages(origen, origen.getPageIndices());
		for (const pagina of paginas) unido.addPage(pagina);
		composicion.push({
			contractType: carta.contractType,
			label: carta.label,
			paginas: paginas.length,
		});
	}

	unido.setTitle("Cartas");
	unido.setKeywords([
		MARCA,
		...composicion.map((c) => `${c.contractType}:${c.paginas}`),
	]);

	return { pdf: Buffer.from(await unido.save()), composicion };
}

/**
 * Qué cartas trae un paquete, leído de sus metadatos.
 *
 * Devuelve `null` si el PDF no es un paquete (no tiene la marca), y lanza si la
 * tiene pero lo que dice no se puede usar: mejor un error a la vista que firmas
 * puestas contra una composición inventada.
 *
 * Las etiquetas no se guardan en el PDF (son texto largo con espacios); las
 * pone quien llama, que tiene el registro de plantillas.
 */
export async function leerComposicion(
	pdf: Buffer,
): Promise<Array<{ contractType: ContractType; paginas: number }> | null> {
	const documento = await PDFDocument.load(pdf, { updateMetadata: false });
	const palabras = (documento.getKeywords() ?? "")
		.split(/\s+/)
		.filter(Boolean);

	if (palabras[0] !== MARCA) return null;

	const composicion = palabras.slice(1).map((palabra) => {
		const [contractType, paginas] = palabra.split(":");
		const cantidad = Number(paginas);
		if (
			!esCartaUnificable(contractType) ||
			!Number.isInteger(cantidad) ||
			cantidad < 1
		) {
			throw new SignatureLayoutError(
				`El paquete dice traer "${palabra}", que no es una carta con su cantidad de páginas.`,
			);
		}
		return { contractType: contractType as ContractType, paginas: cantidad };
	});

	if (composicion.length === 0) {
		throw new SignatureLayoutError(
			"El paquete no dice qué cartas trae. Hay que regenerar las cartas.",
		);
	}

	const total = composicion.reduce((n, c) => n + c.paginas, 0);
	if (total !== documento.getPageCount()) {
		throw new SignatureLayoutError(
			`El paquete dice tener ${total} página(s) pero el PDF tiene ${documento.getPageCount()}. Hay que regenerar las cartas.`,
		);
	}

	return composicion;
}

/**
 * Dónde firma cada quien en el paquete.
 *
 * Separa el PDF unido en sus cartas, ubica las firmas de cada una con su propio
 * layout (el mismo que se usaría si se mandara suelta, con la misma
 * verificación de cantidad de líneas), y las corre a su número de página en el
 * documento completo.
 *
 * Si una carta no calza con su layout, falla el paquete entero: una carta sin
 * firma dentro de un documento "firmado" es peor que no mandarlo.
 */
export async function posicionesDelPaquete(
	pdf: Buffer,
	composicion: Array<{ contractType: ContractType; paginas: number }>,
	signers: ContractSigner[],
): Promise<WeeTrustSignaturePosition[]> {
	const origen = await PDFDocument.load(pdf, { updateMetadata: false });
	const posiciones: WeeTrustSignaturePosition[] = [];

	let antes = 0;
	for (const carta of composicion) {
		const suelta = await PDFDocument.create();
		const indices = Array.from({ length: carta.paginas }, (_, i) => antes + i);
		const paginas = await suelta.copyPages(origen, indices);
		for (const pagina of paginas) suelta.addPage(pagina);

		let deEstaCarta: WeeTrustSignaturePosition[];
		try {
			deEstaCarta = await WeeTrustService.locateSignatureWidgets(
				Buffer.from(await suelta.save()),
				carta.contractType,
				signers,
			);
		} catch (error) {
			// Que se sepa cuál de las cartas no calzó: en el paquete son varias.
			if (error instanceof SignatureLayoutError) {
				throw new SignatureLayoutError(
					`En las cartas unidas, ${carta.contractType} (páginas ${antes + 1}-${antes + carta.paginas}): ${error.message}`,
				);
			}
			throw error;
		}

		for (const posicion of deEstaCarta) {
			posiciones.push({ ...posicion, page: posicion.page + antes });
		}
		antes += carta.paginas;
	}

	if (antes !== origen.getPageCount()) {
		throw new SignatureLayoutError(
			`Las cartas suman ${antes} página(s) pero el documento tiene ${origen.getPageCount()}.`,
		);
	}

	return posiciones;
}
