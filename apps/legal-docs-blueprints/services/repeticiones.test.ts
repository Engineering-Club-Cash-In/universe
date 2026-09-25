/**
 * Documentos que traen menos repeticiones del bloque de firmas que las
 * declaradas.
 *
 * Los anexos de inversiones son dos, pero a veces se manda uno solo unificado:
 * ahí se firman las repeticiones completas que haya. En la cobertura no: sus
 * dos secciones son obligatorias, y un PDF con una sola es un documento
 * incompleto que no puede salir a firma.
 *
 *   bun test services/repeticiones.test.ts
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { WeeTrustService } from "./WeeTrustService";
import { SignatureLayoutError } from "./signaturePatterns";
import { ContractType, SignerRole, type ContractSigner } from "../types/contract";

/** Una hoja con cada texto en su renglón, de arriba hacia abajo. */
async function pdfConRenglones(renglones: string[]): Promise<Buffer> {
	const doc = await PDFDocument.create();
	const fuente = await doc.embedFont(StandardFonts.Helvetica);
	const pagina = doc.addPage([612, 792]);
	renglones.forEach((texto, i) => {
		pagina.drawText(texto, { x: 72, y: 700 - i * 80, size: 10, font: fuente });
	});
	return Buffer.from(await doc.save());
}

const TITULAR: ContractSigner = {
	role: SignerRole.TITULAR,
	email: "titular@test",
	name: "Titular",
};
const REP_LEGAL: ContractSigner = {
	role: SignerRole.REP_LEGAL,
	email: "replegal@test",
	name: "Rep Legal",
};

describe("repeticiones del bloque de firmas", () => {
	test("una cobertura con una sola de sus dos secciones se rechaza", async () => {
		const pdf = await pdfConRenglones(["Firma:___________________________"]);

		await expect(
			WeeTrustService.locateSignatureWidgets(
				pdf,
				ContractType.COBERTURA_INREXSA,
				[TITULAR],
			),
		).rejects.toBeInstanceOf(SignatureLayoutError);
	});

	test("la cobertura con sus dos secciones sigue pasando", async () => {
		const pdf = await pdfConRenglones([
			"Firma:___________________________",
			"Firma:___________________________",
		]);

		const posiciones = await WeeTrustService.locateSignatureWidgets(
			pdf,
			ContractType.COBERTURA_INREXSA,
			[TITULAR],
		);
		expect(posiciones.filter((p) => p.imageSize.width >= 100)).toHaveLength(2);
	});

	test("un anexo unificado (una sola repetición completa) se firma", async () => {
		const pdf = await pdfConRenglones([
			"Firma del Inversionista",
			"Recibido por Cube Investments, S.A.",
		]);

		const posiciones = await WeeTrustService.locateSignatureWidgets(
			pdf,
			ContractType.ANEXOS_CONFIRMACION_PARTICIPACION_BENEFICIARIO,
			[TITULAR, REP_LEGAL],
		);
		expect(posiciones.filter((p) => p.imageSize.width >= 100)).toHaveLength(2);
	});
});
