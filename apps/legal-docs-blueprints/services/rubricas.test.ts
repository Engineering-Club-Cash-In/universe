/**
 * Las rúbricas de páginas impares.
 *
 * Se prueban contra un PDF armado acá, no contra un template: lo que interesa
 * es dónde caen los widgets y a quién le tocan, no cómo se ve un contrato. Un
 * PDF sintético además deja mover las firmas reales a la franja de las rúbricas
 * para verificar que se apartan, que con los templates reales no se puede.
 *
 *   bun test services/rubricas.test.ts
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getRubrica } from "./signaturePatterns";
import { WeeTrustService } from "./WeeTrustService";
import { ContractType, SignerRole, type ContractSigner } from "../types/contract";

const LINEA = "f)_______________________________________";

const FIRMANTES: ContractSigner[] = [
	{ role: SignerRole.TITULAR, email: "titular@test", name: "Titular" },
	{ role: SignerRole.COFIRMANTE, email: "codeudor@test", name: "Codeudor" },
	{ role: SignerRole.REP_LEGAL, email: "replegal@test", name: "Rep Legal" },
];

/**
 * Un PDF de `paginas` hojas con las tres líneas de firma en la última.
 *
 * `tercera` permite bajar la línea del codeudor a la franja donde van las
 * rúbricas, para los casos en que se estorbarían.
 */
async function pdfDePrueba(
	paginas: number,
	/** Dónde va la tercera línea (la del codeudor), en coordenadas del PDF. */
	tercera: { x: number; y: number } = { x: 72, y: 300 },
): Promise<Buffer> {
	const doc = await PDFDocument.create();
	const fuente = await doc.embedFont(StandardFonts.Helvetica);

	for (let i = 1; i <= paginas; i++) {
		const pagina = doc.addPage([612, 792]);
		pagina.drawText(`Pagina ${i}`, { x: 72, y: 720, size: 11, font: fuente });

		if (i === paginas) {
			// Orden de lectura: arriba hacia abajo, luego izquierda a derecha.
			pagina.drawText(LINEA, { x: 72, y: 380, size: 10, font: fuente });
			pagina.drawText(LINEA, { x: 320, y: 380, size: 10, font: fuente });
			pagina.drawText(LINEA, { ...tercera, size: 10, font: fuente });
		}
	}

	return Buffer.from(await doc.save());
}

/** Las rúbricas son más chicas que una firma (100×50). */
const esRubrica = (p: { imageSize: { width: number } }) => p.imageSize.width < 100;

/** Rep legal, titular y `codeudores` codeudores, en el orden en que firman. */
function firmantesDePrueba(codeudores: number): ContractSigner[] {
	return [
		{ role: SignerRole.REP_LEGAL, email: "replegal@test", name: "Rep Legal" },
		{ role: SignerRole.TITULAR, email: "titular@test", name: "Titular" },
		...Array.from({ length: codeudores }, (_, i) => ({
			role: SignerRole.COFIRMANTE,
			email: `codeudor${i}@test`,
			name: `Codeudor ${i}`,
		})),
	];
}

/**
 * Dos hojas, con una línea de firma por firmante en la segunda: el rep legal
 * arriba y los deudores en filas de dos.
 */
async function pdfConFirmantes(cuantos: number): Promise<Buffer> {
	const doc = await PDFDocument.create();
	const fuente = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 1; i <= 2; i++) {
		const pagina = doc.addPage([612, 792]);
		pagina.drawText(`Pagina ${i}`, { x: 72, y: 720, size: 11, font: fuente });
		if (i === 2) {
			pagina.drawText(LINEA, { x: 72, y: 600, size: 10, font: fuente });
			for (let d = 0; d < cuantos - 1; d++) {
				pagina.drawText(LINEA, {
					x: d % 2 === 0 ? 72 : 320,
					y: 520 - Math.floor(d / 2) * 60,
					size: 10,
					font: fuente,
				});
			}
		}
	}
	return Buffer.from(await doc.save());
}

/** Las rúbricas de una página, de izquierda a derecha. */
const rubricasDeLaPagina = (
	posiciones: Awaited<ReturnType<typeof WeeTrustService.locateSignatureWidgets>>,
	pagina: number,
) =>
	posiciones
		.filter((p) => esRubrica(p) && p.page === pagina)
		.sort((a, b) => a.coordinates.x - b.coordinates.x);

describe("rúbricas de páginas impares", () => {
	test("pone una por firmante en cada página impar, y ninguna en las pares", async () => {
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(8),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);

		const rubricas = posiciones.filter(esRubrica);
		// Páginas 1, 3, 5 y 7 × 3 firmantes.
		expect(rubricas).toHaveLength(12);
		expect([...new Set(rubricas.map((r) => r.page))].sort((a, b) => a - b)).toEqual(
			[1, 3, 5, 7],
		);

		for (const pagina of [1, 3, 5, 7]) {
			const enLaPagina = rubricas.filter((r) => r.page === pagina);
			expect(new Set(enLaPagina.map((r) => r.user.email)).size).toBe(3);
		}
	});

	test("no toca las firmas reales ni su cuenta", async () => {
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(8),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);

		const reales = posiciones.filter((p) => !esRubrica(p));
		expect(reales).toHaveLength(3);
		// Todas en la última página, que es donde están las líneas.
		expect(reales.every((p) => p.page === 8)).toBe(true);
	});

	test("si pisaría la firma de otra persona, el grupo sube hasta no pisar ninguna", async () => {
		// La firma real del codeudor, en la franja de abajo, justo donde va la
		// rúbrica del titular.
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(7, { x: 280, y: 60 }),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);
		const reales = posiciones.filter((p) => !esRubrica(p));
		const enLaSeptima = posiciones.filter((p) => p.page === 7 && esRubrica(p));

		// Los tres rubrican igual: nadie se queda sin la suya por la firma de otro.
		expect(enLaSeptima).toHaveLength(3);
		for (const r of enLaSeptima) {
			for (const f of reales.filter((f) => f.page === 7)) {
				const seSolapan =
					r.coordinates.x < f.coordinates.x + f.imageSize.width &&
					f.coordinates.x < r.coordinates.x + r.imageSize.width &&
					r.coordinates.y < f.coordinates.y + f.imageSize.height &&
					f.coordinates.y < r.coordinates.y + r.imageSize.height;
				expect(seSolapan).toBe(false);
			}
		}
	});

	test("sobre la firma real de la misma persona, su rúbrica no va", async () => {
		// La firma del codeudor ocupa sólo el lugar de su propia rúbrica.
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(7, { x: 430, y: 60 }),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);
		const enLaSeptima = posiciones.filter((p) => p.page === 7 && esRubrica(p));

		expect(enLaSeptima).toHaveLength(2);
		expect(enLaSeptima.map((r) => r.user.email)).not.toContain("codeudor@test");
	});

	test("las cartas no llevan rúbrica", async () => {
		const doc = await PDFDocument.create();
		const fuente = await doc.embedFont(StandardFonts.Helvetica);
		const pagina = doc.addPage([612, 792]);
		pagina.drawText("F)_______________________________________", {
			x: 72,
			y: 300,
			size: 10,
			font: fuente,
		});
		const pdf = Buffer.from(await doc.save());

		const posiciones = await WeeTrustService.locateSignatureWidgets(
			pdf,
			ContractType.CARTA_EMISION_CHEQUES,
			[FIRMANTES[0]],
		);

		expect(posiciones).toHaveLength(1);
		expect(posiciones.filter(esRubrica)).toHaveLength(0);
	});

	test("con muchos firmantes pasan a otra fila en vez de salirse de la hoja", async () => {
		const muchos = firmantesDePrueba(6);
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfConFirmantes(muchos.length),
			ContractType.GARANTIA_MOBILIARIA,
			muchos,
		);
		const rubricas = posiciones.filter(esRubrica);

		expect(rubricas).toHaveLength(8);
		for (const r of rubricas) {
			expect(r.coordinates.x).toBeGreaterThanOrEqual(0);
			expect(r.coordinates.x + r.imageSize.width).toBeLessThanOrEqual(612);
		}
		// Dos filas: las que no entraron en la primera quedan en otra.
		expect(new Set(rubricas.map((r) => r.coordinates.y)).size).toBe(2);
	});

	test("si no entran en el alto de la franja, se achican y no tapan ni el pie ni el texto", async () => {
		// El reconocimiento de deuda tiene poco aire entre el pie y el texto: dos
		// filas a tamaño normal no entran. Ni subir sobre el contrato ni bajar
		// sobre el pie de página (que llega casi hasta el borde de la franja).
		const muchos = firmantesDePrueba(6);
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfConFirmantes(muchos.length),
			ContractType.RECONOCIMIENTO_DEUDA,
			muchos,
		);
		const { franja } = getRubrica(ContractType.RECONOCIMIENTO_DEUDA)!;
		const rubricas = posiciones.filter(esRubrica);

		expect(rubricas.length).toBeGreaterThan(0);
		for (const r of rubricas) {
			// Bordes en coordenadas del PDF (origen abajo).
			const arriba = r.viewport.height - r.coordinates.y;
			const abajo = arriba - r.imageSize.height;
			expect(arriba).toBeLessThanOrEqual(franja.arriba);
			expect(abajo).toBeGreaterThanOrEqual(franja.abajo);
		}
	});

	test("se reparten a lo ancho de la franja, en el orden en que firman", async () => {
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(8),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);
		const { franja } = getRubrica(ContractType.GARANTIA_MOBILIARIA)!;
		const fila = rubricasDeLaPagina(posiciones, 1);

		expect(fila.map((r) => r.user.email)).toEqual([
			"replegal@test",
			"titular@test",
			"codeudor@test",
		]);
		// Una sola fila, dentro de la franja: ni sobre el pie ni sobre el texto.
		expect(new Set(fila.map((r) => r.coordinates.y)).size).toBe(1);
		for (const r of fila) {
			const abajo = r.viewport.height - r.coordinates.y - r.imageSize.height;
			expect(abajo).toBeGreaterThanOrEqual(franja.abajo);
			expect(abajo + r.imageSize.height).toBeLessThanOrEqual(franja.arriba);
			expect(r.coordinates.x).toBeGreaterThanOrEqual(franja.izquierda);
			expect(r.coordinates.x + r.imageSize.width).toBeLessThanOrEqual(
				franja.derecha,
			);
		}
		// Repartidas, no juntas en un rincón: ocupan casi todo el ancho, con la
		// misma separación entre cada una.
		const primera = fila[0];
		const ultima = fila[fila.length - 1];
		const ocupado =
			ultima.coordinates.x + ultima.imageSize.width - primera.coordinates.x;
		expect(ocupado).toBeGreaterThan((franja.derecha - franja.izquierda) * 0.75);
		const huecos = fila
			.slice(1)
			.map((r, i) => r.coordinates.x - (fila[i].coordinates.x + fila[i].imageSize.width));
		for (const hueco of huecos) expect(hueco).toBeCloseTo(huecos[0], 5);
	});

	test("con menos firmantes, rúbricas más grandes", async () => {
		const pocos = firmantesDePrueba(0);
		const hastaTres = firmantesDePrueba(3);
		const [conDos, conCinco] = await Promise.all([
			WeeTrustService.locateSignatureWidgets(
				await pdfConFirmantes(pocos.length),
				ContractType.GARANTIA_MOBILIARIA,
				pocos,
			),
			WeeTrustService.locateSignatureWidgets(
				await pdfConFirmantes(hastaTres.length),
				ContractType.GARANTIA_MOBILIARIA,
				hastaTres,
			),
		]);

		const anchoCon = (p: typeof conDos) => rubricasDeLaPagina(p, 1)[0].imageSize.width;
		expect(anchoCon(conDos)).toBeGreaterThan(anchoCon(conCinco));
		// El caso más grande de todos los días (tres codeudores) entra en una fila.
		expect(
			new Set(rubricasDeLaPagina(conCinco, 1).map((r) => r.coordinates.y)).size,
		).toBe(1);
	});

	test("caben dentro de la hoja", async () => {
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(6),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);

		for (const rubrica of posiciones.filter(esRubrica)) {
			expect(rubrica.coordinates.x).toBeGreaterThanOrEqual(0);
			expect(rubrica.coordinates.y).toBeGreaterThanOrEqual(0);
			expect(rubrica.coordinates.x + rubrica.imageSize.width).toBeLessThanOrEqual(
				rubrica.viewport.width,
			);
			expect(rubrica.coordinates.y + rubrica.imageSize.height).toBeLessThanOrEqual(
				rubrica.viewport.height,
			);
		}
	});
});
