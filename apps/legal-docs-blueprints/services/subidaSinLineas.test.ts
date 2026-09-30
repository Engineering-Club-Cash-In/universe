import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ContractType, SignerRole } from "../types/contract";
import { ContractGeneratorService } from "./ContractGeneratorService";
import { SignatureLayoutError } from "./signaturePatterns";
import { WeeTrustService } from "./WeeTrustService";

// Sin WeeTrust ni R2 de verdad: el documento "falla" al ubicar las firmas y el
// PDF se guarda en una key falsa. `mock.module` reemplaza las exportaciones en
// vivo, así que alcanza con que esté antes de llamar.
const subidos: string[] = [];
mock.module("./R2Service", () => ({
	uploadPdfToR2: async (_pdf: Buffer, nombre: string) => {
		subidos.push(nombre);
		return { r2Key: `contratos/${nombre}.pdf` };
	},
	urlFirmadaDePdf: async (key: string) => `https://r2/${key}`,
	downloadPdfFromR2: async () => Buffer.from(""),
}));

let intentos = 0;
WeeTrustService.prototype.createDocumentForSigning = async () => {
	intentos += 1;
	throw new SignatureLayoutError(
		'El contrato tiene 0 línea(s) de firma en el PDF pero se esperaban 2',
	);
};

const generador = new ContractGeneratorService();
const PDF = Buffer.from("%PDF-1.4\n%prueba\n");
const firmantes = [
	{ role: SignerRole.TITULAR, email: "ana@x.com", name: "ANA DE PRUEBA" },
	{ role: SignerRole.REP_LEGAL, email: "andres@x.com", name: "ANDRÉS" },
];

beforeEach(() => {
	subidos.length = 0;
	intentos = 0;
});

// El generador arranca sin WeeTrust si faltan sus credenciales, y entonces no
// hay subida que probar: estos casos necesitan el .env del servicio.
const sinCredenciales =
	!process.env.WEETRUST_USER_ID || !process.env.WEETRUST_API_KEY;

describe.skipIf(sinCredenciales)("subir a mano un PDF sin los espacios de firma", () => {
	test("si se pide, se guarda sin mandarlo y dice por qué", async () => {
		const resultado = await generador.signExistingPdf(
			ContractType.RECONOCIMIENTO_DEUDA,
			PDF,
			{ filenamePrefix: "escaneo", signers: firmantes, guardarSiNoHayLineas: true },
		);

		expect(intentos).toBe(1);
		expect(resultado.success).toBe(true);
		expect(resultado.r2Key).toBe("contratos/escaneo.pdf");
		expect(resultado.sinLineasDeFirma).toMatch(/0 línea/);
		expect(resultado.documentID).toBeUndefined();
		expect(resultado.signing_links).toBeUndefined();
	});

	test("si no se pide, se rechaza como siempre y no se guarda nada", async () => {
		const resultado = await generador.signExistingPdf(
			ContractType.RECONOCIMIENTO_DEUDA,
			PDF,
			{ filenamePrefix: "escaneo", signers: firmantes },
		);

		expect(resultado.success).toBe(false);
		expect(resultado.error).toMatch(/0 línea/);
		expect(subidos).toEqual([]);
	});

	test("la reemisión nunca lo deja pasar: el PDF es nuestro", async () => {
		const resultado = await generador.signExistingPdf(
			ContractType.RECONOCIMIENTO_DEUDA,
			PDF,
			{
				signers: firmantes,
				guardarSiNoHayLineas: true,
				r2KeyExistente: "contratos/ya-estaba.pdf",
			},
		);

		expect(resultado.success).toBe(false);
		expect(subidos).toEqual([]);
	});
});
