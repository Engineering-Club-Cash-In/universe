/**
 * Las rúbricas de páginas impares.
 *
 * Se prueban contra un PDF armado acá, no contra un template: lo que interesa
 * es dónde caen los widgets y a quién le tocan, no cómo se ve un contrato. Un
 * PDF sintético además deja mover las firmas reales a la esquina para verificar
 * que la rúbrica se aparta, que con los templates reales no se puede.
 *
 *   bun test services/rubricas.test.ts
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
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
 * `firmaEnLaEsquina` las pone abajo a la derecha, que es donde van las
 * rúbricas: sirve para el caso en que se estorbarían.
 */
async function pdfDePrueba(
	paginas: number,
	firmaEnLaEsquina = false,
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
			pagina.drawText(LINEA, {
				x: firmaEnLaEsquina ? 500 : 72,
				y: firmaEnLaEsquina ? 60 : 300,
				size: 10,
				font: fuente,
			});
		}
	}

	return Buffer.from(await doc.save());
}

/** Las rúbricas son más chicas que una firma (100×50). */
const esRubrica = (p: { imageSize: { width: number } }) => p.imageSize.width < 100;

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

	test("se aparta cuando la firma real ocupa la esquina", async () => {
		const posiciones = await WeeTrustService.locateSignatureWidgets(
			await pdfDePrueba(7, true),
			ContractType.GARANTIA_MOBILIARIA,
			FIRMANTES,
		);

		const enLaSeptima = posiciones.filter((p) => p.page === 7 && esRubrica(p));
		// El tercer firmante firma de verdad en esa esquina: su rúbrica no va.
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
