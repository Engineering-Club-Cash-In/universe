/**
 * Las cartas unidas en un solo documento.
 *
 * Los PDF se arman acá, con páginas de distinto tamaño como las cartas reales
 * (la de cheques es oficio, otras A4 o carta): lo que se prueba es que cada
 * firma caiga en su carta, con la medida de su propia página, y que el paquete
 * se pueda volver a leer al reemitirlo.
 *
 *   bun test services/paqueteCartas.test.ts
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
	leerComposicion,
	posicionesDelPaquete,
	unirCartas,
} from "./paqueteCartas";
import { SignatureLayoutError } from "./signaturePatterns";
import { ContractType, SignerRole, type ContractSigner } from "../types/contract";

const OFICIO: [number, number] = [612, 1008];
const A4: [number, number] = [595.3, 841.9];
const CARTA: [number, number] = [612, 792];

const FIRMANTES: ContractSigner[] = [
	{ role: SignerRole.TITULAR, email: "titular@test", name: "Titular" },
	{ role: SignerRole.COFIRMANTE, email: "codeudor@test", name: "Codeudor" },
];

/**
 * Un PDF de una carta. `lineasPorPagina[i]` es cuántas líneas de firma lleva
 * la página i, una al lado de la otra como en los templates plural.
 */
async function carta(
	tamano: [number, number],
	linea: string,
	lineasPorPagina: number[],
): Promise<Buffer> {
	const doc = await PDFDocument.create();
	const fuente = await doc.embedFont(StandardFonts.Helvetica);
	for (const lineas of lineasPorPagina) {
		const pagina = doc.addPage(tamano);
		pagina.drawText("Texto de la carta", { x: 72, y: tamano[1] - 100, size: 11, font: fuente });
		for (let i = 0; i < lineas; i++) {
			pagina.drawText(linea, { x: 72 + i * 240, y: 200, size: 10, font: fuente });
		}
	}
	return Buffer.from(await doc.save());
}

/** Tres cartas como las de una venta real: oficio, A4 y la cobertura de dos hojas. */
async function tresCartas() {
	return [
		{
			contractType: ContractType.CARTA_EMISION_CHEQUES,
			label: "Carta de emisión de cheques",
			pdf: await carta(OFICIO, "f)________________________", [2]),
		},
		{
			contractType: ContractType.SOLICITUD_COMPRA_VEHICULO,
			label: "Carta de solicitud de compra",
			pdf: await carta(A4, "F)_______________________________________", [2]),
		},
		{
			contractType: ContractType.COBERTURA_INREXSA,
			label: "Carta de cobertura",
			// Dos juegos de firma, uno por hoja (repeticiones: 2).
			pdf: await carta(CARTA, "Firma:___________________________", [2, 2]),
		},
	];
}

describe("unir las cartas", () => {
	test("junta las páginas en orden y dice cuántas son de cada una", async () => {
		const { pdf, composicion } = await unirCartas(await tresCartas());

		expect(composicion.map((c) => [c.contractType, c.paginas])).toEqual([
			[ContractType.CARTA_EMISION_CHEQUES, 1],
			[ContractType.SOLICITUD_COMPRA_VEHICULO, 1],
			[ContractType.COBERTURA_INREXSA, 2],
		]);

		const unido = await PDFDocument.load(pdf);
		expect(unido.getPageCount()).toBe(4);
	});

	test("cada página conserva su tamaño", async () => {
		const { pdf } = await unirCartas(await tresCartas());
		const unido = await PDFDocument.load(pdf);
		const tamanos = unido.getPages().map((p) => {
			const { width, height } = p.getSize();
			return [Math.round(width), Math.round(height)];
		});
		expect(tamanos).toEqual([
			[612, 1008],
			[595, 842],
			[612, 792],
			[612, 792],
		]);
	});

	test("no acepta algo que no es carta", async () => {
		const contrato = {
			contractType: ContractType.GARANTIA_MOBILIARIA,
			label: "Garantía",
			pdf: await carta(CARTA, "f)_______________________________________", [2]),
		};
		await expect(unirCartas([contrato])).rejects.toThrow(SignatureLayoutError);
	});

	test("el descargo de responsabilidades no es una carta", async () => {
		const descargo = {
			contractType: ContractType.DESCARGO_RESPONSABILIDADES,
			label: "Descargo",
			pdf: await carta(CARTA, "f)____________________________________", [2]),
		};
		await expect(unirCartas([descargo])).rejects.toThrow(SignatureLayoutError);
	});
});

describe("leer qué trae un paquete", () => {
	test("el PDF unido dice qué cartas trae", async () => {
		const { pdf } = await unirCartas(await tresCartas());
		expect(await leerComposicion(pdf)).toEqual([
			{ contractType: ContractType.CARTA_EMISION_CHEQUES, paginas: 1 },
			{ contractType: ContractType.SOLICITUD_COMPRA_VEHICULO, paginas: 1 },
			{ contractType: ContractType.COBERTURA_INREXSA, paginas: 2 },
		]);
	});

	test("un PDF cualquiera no es un paquete", async () => {
		const suelto = await carta(CARTA, "F)________________________", [1]);
		expect(await leerComposicion(suelto)).toBeNull();
	});
});

describe("dónde firma cada quien", () => {
	test("cada firma cae en la página de su carta, con la medida de esa página", async () => {
		const { pdf, composicion } = await unirCartas(await tresCartas());
		const posiciones = await posicionesDelPaquete(pdf, composicion, FIRMANTES);

		// Cheques: 2 firmas en la 1. Compra: 2 en la 2. Cobertura: 2 + 2 en la 3 y 4.
		expect(posiciones.map((p) => p.page)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);

		// La medida viene de su propia página: una firma en la hoja oficio medida
		// como A4 quedaría corrida.
		expect(posiciones[0].viewport.height).toBe(1008);
		expect(Math.round(posiciones[2].viewport.height)).toBe(842);
		expect(posiciones[4].viewport.height).toBe(792);
	});

	test("en cada carta firman el titular y el codeudor, en ese orden", async () => {
		const { pdf, composicion } = await unirCartas(await tresCartas());
		const posiciones = await posicionesDelPaquete(pdf, composicion, FIRMANTES);

		for (let i = 0; i < posiciones.length; i += 2) {
			expect(posiciones[i].user.email).toBe("titular@test");
			expect(posiciones[i + 1].user.email).toBe("codeudor@test");
		}
	});

	test("las cartas no llevan rúbrica, aunque el paquete tenga varias hojas", async () => {
		const { pdf, composicion } = await unirCartas(await tresCartas());
		const posiciones = await posicionesDelPaquete(pdf, composicion, FIRMANTES);
		// Todas son firmas de tamaño completo: ninguna rúbrica chica.
		expect(posiciones.every((p) => p.imageSize.width === 100)).toBe(true);
	});

	test("una carta que no calza hace fallar el paquete y dice cuál fue", async () => {
		const cartas = await tresCartas();
		// La de compra con una sola línea: le falta la del codeudor.
		cartas[1].pdf = await carta(A4, "F)_______________________________________", [1]);
		const { pdf, composicion } = await unirCartas(cartas);

		const intento = posicionesDelPaquete(pdf, composicion, FIRMANTES);
		await expect(intento).rejects.toThrow(SignatureLayoutError);
		await expect(intento).rejects.toThrow(/solicitud_compra_vehiculo_tercero/);
	});

	test("al reemitir, lo leído del PDF alcanza para ubicar lo mismo", async () => {
		const { pdf, composicion } = await unirCartas(await tresCartas());
		const alGenerar = await posicionesDelPaquete(pdf, composicion, FIRMANTES);

		const leida = await leerComposicion(pdf);
		expect(leida).not.toBeNull();
		const alReemitir = await posicionesDelPaquete(pdf, leida ?? [], FIRMANTES);

		expect(alReemitir).toEqual(alGenerar);
	});
});
