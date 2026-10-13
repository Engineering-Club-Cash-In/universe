/**
 * Firmas que se ubican por una etiqueta impresa debajo de la línea y firmas
 * que se ubican por una raya, en el mismo documento.
 *
 * El contrato de participación de sociedad mezcla las dos: CUBE se encuentra
 * por su etiqueta ("CUBE INVESTMENTS, S.A."), y al cuadro hay que subirlo para
 * que quede sobre la línea dibujada; el representante de la sociedad firma en
 * una raya, y ahí el cuadro ya queda bien.
 *
 *   bun test services/firmaPorEtiqueta.test.ts
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { WeeTrustService } from "./WeeTrustService";
import { ContractType, SignerRole, type ContractSigner } from "../types/contract";

const ALTO_PAGINA = 1008;
const ALTO_FIRMA = 50;

/** Una hoja oficio con cada texto donde se le diga. */
async function pdfCon(textos: Array<{ texto: string; x: number; y: number }>): Promise<Buffer> {
	const doc = await PDFDocument.create();
	const fuente = await doc.embedFont(StandardFonts.Helvetica);
	const pagina = doc.addPage([612, ALTO_PAGINA]);
	for (const { texto, x, y } of textos) {
		pagina.drawText(texto, { x, y, size: 10, font: fuente });
	}
	return Buffer.from(await doc.save());
}

const REPRESENTANTE: ContractSigner = {
	role: SignerRole.TITULAR,
	email: "representante@test",
	name: "Representante",
};
const REP_LEGAL: ContractSigner = {
	role: SignerRole.REP_LEGAL,
	email: "replegal@test",
	name: "Rep Legal",
};

/** Las firmas, sin las rúbricas por hoja (que son más chicas). */
const firmas = <T extends { imageSize: { width: number } }>(posiciones: T[]) =>
	posiciones.filter((p) => p.imageSize.width >= 100);

describe("subir el cuadro sobre la etiqueta", () => {
	test("en el contrato de sociedad sube sólo el de CUBE, no el de la raya", async () => {
		const pdf = await pdfCon([
			// Columna de la sociedad: la raya, a la altura de la línea de CUBE.
			{ texto: "___________________________________", x: 330, y: 300 },
			// Columna de CUBE: la etiqueta, impresa debajo de su línea.
			{ texto: "CUBE INVESTMENTS, S.A.", x: 70, y: 284 },
		]);

		const posiciones = firmas(
			await WeeTrustService.locateSignatureWidgets(
				pdf,
				ContractType.CONTRATO_PARTICIPACION_ADMINISTRACION_CARTERA_SOCIEDAD,
				[REPRESENTANTE, REP_LEGAL],
			),
		);

		expect(posiciones).toHaveLength(2);
		const [sociedad, cube] = posiciones;
		// La raya va primero en orden de lectura y es la del representante.
		expect(sociedad.user.email).toBe(REPRESENTANTE.email);
		expect(sociedad.coordinates.y).toBeCloseTo(ALTO_PAGINA - 300 - ALTO_FIRMA, 0);
		// La etiqueta de CUBE sube los 16 puntos declarados.
		expect(cube.user.email).toBe(REP_LEGAL.email);
		expect(cube.coordinates.y).toBeCloseTo(ALTO_PAGINA - 284 - ALTO_FIRMA - 16, 0);
	});

	test("los anexos separados llevan un solo par de firmas, las dos sobre su etiqueta", async () => {
		for (const tipo of [
			ContractType.ANEXO1_CONFIRMACION_PARTICIPACION,
			ContractType.ANEXO2_DESIGNACION_BENEFICIARIO,
			ContractType.ANEXO1_CONFIRMACION_PARTICIPACION_SOCIEDAD,
			ContractType.ANEXO2_DESIGNACION_BENEFICIARIO_SOCIEDAD,
		]) {
			const pdf = await pdfCon([
				{ texto: "Firma del Inversionista", x: 120, y: 400 },
				{ texto: "Recibido por Cube Investments, S.A.", x: 360, y: 400 },
			]);

			const posiciones = firmas(
				await WeeTrustService.locateSignatureWidgets(pdf, tipo, [REPRESENTANTE, REP_LEGAL]),
			);

			expect(posiciones.map((p) => p.user.email)).toEqual([
				REPRESENTANTE.email,
				REP_LEGAL.email,
			]);
			for (const p of posiciones) {
				expect(p.coordinates.y).toBeCloseTo(ALTO_PAGINA - 400 - ALTO_FIRMA - 13, 0);
			}
		}
	});
});

describe("dónde arranca el cuadro en una raya con etiqueta", () => {
	const TITULAR: ContractSigner = { role: SignerRole.TITULAR, email: "titular@test", name: "Titular" };

	test("en la cobertura de G&T arranca en la raya, no sobre «Firma:»", async () => {
		const pdf = await pdfCon([{ texto: "Firma:___________________________", x: 100, y: 300 }]);
		const [firma] = firmas(
			await WeeTrustService.locateSignatureWidgets(pdf, ContractType.COBERTURA_GYT, [TITULAR]),
		);
		// "Firma:" en Helvetica 10 mide unos 28 puntos.
		expect(firma.coordinates.x).toBeGreaterThan(120);
		expect(firma.coordinates.x).toBeLessThan(140);
		expect(firma.coordinates.y).toBeCloseTo(ALTO_PAGINA - 300 - ALTO_FIRMA, 0);
	});

	test("sin la opción, el cuadro sigue arrancando donde empieza el texto", async () => {
		const pdf = await pdfCon([{ texto: "F)_______________________________________", x: 100, y: 300 }]);
		const [firma] = firmas(
			await WeeTrustService.locateSignatureWidgets(
				pdf,
				ContractType.CARTA_SOLICITUD_TRASPASO_VEHICULO,
				[TITULAR],
			),
		);
		expect(firma.coordinates.x).toBeCloseTo(100, 0);
	});
});
