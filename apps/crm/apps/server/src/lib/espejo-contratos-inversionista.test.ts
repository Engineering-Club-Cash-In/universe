import { beforeEach, describe, expect, mock, test } from "bun:test";

/** El contrato que devuelve la base en cada prueba. */
let contrato: Record<string, unknown> | undefined;
/** Qué contesta cartera al actualizar el estado. */
let respuestaDeEstado: {
	success: boolean;
	espejado?: boolean;
	estadoAnterior?: string | null;
} = { success: true, espejado: true, estadoAnterior: "pending" };
let fallaCartera = false;

const upsertInvestorContractDocument = mock(
	async (_input: Record<string, unknown>) => {
		if (fallaCartera) throw new Error("cartera no responde");
		return { success: true };
	},
);
const updateInvestorContractDocumentState = mock(
	async (_input: Record<string, unknown>) => respuestaDeEstado,
);

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: (tabla: { _: { name?: string } }) => ({
				where: () => {
					// El contrato viene de una consulta con `.limit(1)`; los firmantes
					// de una con `.orderBy()`. Se distinguen por ahí.
					const resultado = contrato ? [contrato] : [];
					return {
						limit: async () => resultado,
						orderBy: async () => [
							{
								role: "TITULAR",
								name: "ANA REITER",
								email: "ana@ejemplo.com",
								signingUrl: "https://app.weetrust.mx/signatory/doc/ana",
								status: "pending",
								signedAt: null,
								position: 0,
							},
						],
					};
				},
			}),
		}),
	},
}));
mock.module("../services/cartera-back-client", () => ({
	carteraBackClient: {
		upsertInvestorContractDocument,
		updateInvestorContractDocumentState,
	},
}));
mock.module("./storage", () => ({
	getFileUrlWithBucketInKey: async () => "https://r2.ejemplo/contrato.pdf",
}));

const descargarPdfFirmado = mock(
	async (_documentID: string) => new Blob([new Uint8Array([9, 9, 9])]),
);
mock.module("../services/legal-docs-api", () => ({ descargarPdfFirmado }));

globalThis.fetch = mock(async () => ({
	ok: true,
	status: 200,
	blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
})) as never;

const { espejarContratoEnCartera, espejarEstadoDeFirmaEnCartera } =
	await import("./espejo-contratos-inversionista");

const CONTRATO_DE_INVERSION = {
	id: "contrato-1",
	investorId: 42,
	contractName: "Acuerdo de Inversión Cash In",
	contractType: "acuerdo_inversion_cash_in",
	weetrustDocumentId: "doc-1",
	observerUrl: "https://app.weetrust.mx/observer/doc-1",
	pdfLink: "legal-docs/contratos/acuerdo.pdf",
	status: "pending",
	generatedAt: new Date("2026-09-23T15:00:00.000Z"),
};

beforeEach(() => {
	contrato = { ...CONTRATO_DE_INVERSION };
	respuestaDeEstado = {
		success: true,
		espejado: true,
		estadoAnterior: "pending",
	};
	fallaCartera = false;
	upsertInvestorContractDocument.mockClear();
	updateInvestorContractDocumentState.mockClear();
	descargarPdfFirmado.mockClear();
});

describe("espejo de contratos en cartera", () => {
	test("copia el contrato con su PDF, sus enlaces y su estado", async () => {
		expect(await espejarContratoEnCartera("contrato-1")).toBe(true);

		const enviado = upsertInvestorContractDocument.mock.calls[0][0];
		expect(enviado).toMatchObject({
			inversionista_id: 42,
			contrato_id: "contrato-1",
			tipo_contrato: "acuerdo_inversion_cash_in",
			estado_firma: "pending",
		});
		expect(enviado.firmantes).toEqual([
			{
				rol: "TITULAR",
				nombre: "ANA REITER",
				correo: "ana@ejemplo.com",
				enlace: "https://app.weetrust.mx/signatory/doc/ana",
				estado: "pending",
				firmadoEl: null,
			},
		]);
	});

	test("el nombre lleva la fecha, para distinguir una compra de la otra", async () => {
		await espejarContratoEnCartera("contrato-1");

		expect(upsertInvestorContractDocument.mock.calls[0][0].nombre).toBe(
			"Acuerdo de Inversión Cash In — 23/09/2026",
		);
	});

	test("un contrato sin fecha se copia igual, con el nombre pelado", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, generatedAt: null };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(true);
		expect(upsertInvestorContractDocument.mock.calls[0][0].nombre).toBe(
			"Acuerdo de Inversión Cash In",
		);
	});

	test("un contrato de ventas no se copia a cartera", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, investorId: null };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("sin PDF no se copia, pero tampoco revienta", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, pdfLink: null };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("si cartera no responde, se informa y no se lanza", async () => {
		fallaCartera = true;

		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
	});

	test("el estado de firma se manda sin mover el PDF", async () => {
		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(true);

		expect(updateInvestorContractDocumentState).toHaveBeenCalledTimes(1);
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("al quedar firmado, el borrador se reemplaza por el PDF firmado", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, status: "signed" };
		respuestaDeEstado = {
			success: true,
			espejado: true,
			estadoAnterior: "pending",
		};

		await espejarEstadoDeFirmaEnCartera("contrato-1");

		expect(descargarPdfFirmado).toHaveBeenCalledWith("doc-1");
		expect(upsertInvestorContractDocument).toHaveBeenCalledTimes(1);
	});

	test("un contrato que ya estaba firmado no vuelve a pasear el archivo", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, status: "signed" };
		respuestaDeEstado = {
			success: true,
			espejado: true,
			estadoAnterior: "signed",
		};

		await espejarEstadoDeFirmaEnCartera("contrato-1");

		expect(descargarPdfFirmado).not.toHaveBeenCalled();
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("si WeeTrust no entrega el firmado, el contrato igual queda espejado", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, status: "signed" };
		respuestaDeEstado = {
			success: true,
			espejado: true,
			estadoAnterior: "pending",
		};
		descargarPdfFirmado.mockImplementationOnce(async () => {
			throw new Error("WeeTrust no responde");
		});

		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(true);
	});

	test("si el contrato no estaba copiado, se copia entero", async () => {
		respuestaDeEstado = { success: true, espejado: false };

		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(true);

		expect(updateInvestorContractDocumentState).toHaveBeenCalledTimes(1);
		expect(upsertInvestorContractDocument).toHaveBeenCalledTimes(1);
	});
});
