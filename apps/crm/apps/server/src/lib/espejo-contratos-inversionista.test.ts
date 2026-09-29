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

/** Lo que el espejo le escribió al contrato (la key del PDF firmado). */
let guardadoEnElContrato: Record<string, unknown> | undefined;

mock.module("../db", () => ({
	db: {
		update: () => ({
			set: (valores: Record<string, unknown>) => {
				guardadoEnElContrato = valores;
				return { where: async () => undefined };
			},
		}),
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
const uploadPdfWithBucketInKey = mock(
	async (key: string, _buffer: Buffer) => `bucket-crm/${key}`,
);
/** Qué key se bajó de R2 para copiarla a cartera. */
let bajadoDeR2: string | undefined;

mock.module("./storage", () => ({
	getFileUrlWithBucketInKey: async (key: string) => {
		bajadoDeR2 = key;
		return "https://r2.ejemplo/contrato.pdf";
	},
	uploadPdfWithBucketInKey,
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
	uploadPdfWithBucketInKey.mockClear();
	guardadoEnElContrato = undefined;
	bajadoDeR2 = undefined;
});

/** Un contrato ya firmado, con su PDF firmado guardado en R2. */
const FIRMADO = {
	...CONTRATO_DE_INVERSION,
	status: "signed",
	signedPdfLink: "bucket-crm/legal-contracts/firmados/contrato-1.pdf",
};

describe("espejo de contratos en cartera", () => {
	test("el firmado se copia con su PDF, sus enlaces y visible", async () => {
		contrato = { ...FIRMADO };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(true);

		const enviado = upsertInvestorContractDocument.mock.calls[0][0];
		expect(enviado).toMatchObject({
			inversionista_id: 42,
			contrato_id: "contrato-1",
			tipo_contrato: "acuerdo_inversion_cash_in",
			estado_firma: "signed",
			visible: true,
		});
		expect(enviado.firmantes).toEqual([
			{
				rol: "TITULAR",
				nombre: "ANA REITER",
				correo: "ana@ejemplo.com",
				// El enlace de firma no viaja a cartera.
				enlace: null,
				estado: "pending",
				firmadoEl: null,
			},
		]);
	});

	test("mientras se firma no se copia nada: se ve en la tarjeta de contratos", async () => {
		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(false);

		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
		expect(updateInvestorContractDocumentState).not.toHaveBeenCalled();
	});

	test("el nombre lleva la fecha, para distinguir una compra de la otra", async () => {
		contrato = { ...FIRMADO };

		await espejarContratoEnCartera("contrato-1");

		expect(upsertInvestorContractDocument.mock.calls[0][0].nombre).toBe(
			"Acuerdo de Inversión Cash In — 23/09/2026",
		);
	});

	test("un contrato sin fecha se copia igual, con el nombre pelado", async () => {
		contrato = { ...FIRMADO, generatedAt: null };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(true);
		expect(upsertInvestorContractDocument.mock.calls[0][0].nombre).toBe(
			"Acuerdo de Inversión Cash In",
		);
	});

	test("un contrato de ventas no se copia a cartera", async () => {
		contrato = { ...FIRMADO, investorId: null };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("sin PDF no se copia, pero tampoco revienta", async () => {
		contrato = { ...FIRMADO, pdfLink: null, signedPdfLink: null };

		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("si cartera no responde, se informa y no se lanza", async () => {
		contrato = { ...FIRMADO };
		fallaCartera = true;

		expect(await espejarContratoEnCartera("contrato-1")).toBe(false);
	});

	test("al quedar firmado se baja el PDF firmado, se guarda y se copia", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, status: "signed" };

		await espejarEstadoDeFirmaEnCartera("contrato-1");

		expect(descargarPdfFirmado).toHaveBeenCalledWith("doc-1");
		// Queda en R2 y la key se escribe en el contrato: es la marca de que ya no
		// hay que volver a pedírselo a WeeTrust.
		expect(uploadPdfWithBucketInKey.mock.calls[0][0]).toBe(
			"legal-contracts/firmados/contrato-1.pdf",
		);
		expect(guardadoEnElContrato).toMatchObject({
			signedPdfLink: "bucket-crm/legal-contracts/firmados/contrato-1.pdf",
		});
		expect(upsertInvestorContractDocument).toHaveBeenCalledTimes(1);
	});

	test("con el firmado ya guardado y copiado no se le pide nada más a WeeTrust", async () => {
		contrato = { ...FIRMADO };

		await espejarEstadoDeFirmaEnCartera("contrato-1");

		expect(descargarPdfFirmado).not.toHaveBeenCalled();
		expect(updateInvestorContractDocumentState).toHaveBeenCalledTimes(1);
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("si WeeTrust no entrega el firmado, el estado igual se espeja", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, status: "signed" };
		descargarPdfFirmado.mockImplementationOnce(async () => {
			throw new Error("WeeTrust no responde");
		});

		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(true);
		// Sin archivo no se escribe la marca: se vuelve a intentar en la próxima
		// consulta de estado.
		expect(guardadoEnElContrato).toBeUndefined();
	});

	test("la papelería recibe el firmado, no el borrador", async () => {
		contrato = { ...FIRMADO };

		await espejarContratoEnCartera("contrato-1");

		expect(bajadoDeR2).toBe(
			"bucket-crm/legal-contracts/firmados/contrato-1.pdf",
		);
	});

	test("un firmado que no estaba copiado se copia entero", async () => {
		contrato = { ...FIRMADO };
		respuestaDeEstado = { success: true, espejado: false };

		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(true);

		expect(updateInvestorContractDocumentState).toHaveBeenCalledTimes(1);
		expect(upsertInvestorContractDocument).toHaveBeenCalledTimes(1);
	});

	test("un anulado que estaba copiado se oculta, y uno que no, no se copia", async () => {
		contrato = { ...CONTRATO_DE_INVERSION, status: "cancelled" };
		respuestaDeEstado = { success: true, espejado: false };

		await espejarEstadoDeFirmaEnCartera("contrato-1");

		expect(updateInvestorContractDocumentState.mock.calls[0][0]).toMatchObject({
			visible: false,
		});
		expect(upsertInvestorContractDocument).not.toHaveBeenCalled();
	});

	test("si lo anulan mientras viaja el firmado, se vuelve a mandar oculto", async () => {
		contrato = { ...FIRMADO };
		// El "Anular" se guarda mientras cartera recibe el firmado: lo que quedó
		// allá es la foto vieja, visible.
		updateInvestorContractDocumentState.mockImplementationOnce(async () => {
			contrato = { ...FIRMADO, status: "cancelled" };
			return respuestaDeEstado;
		});

		expect(await espejarEstadoDeFirmaEnCartera("contrato-1")).toBe(true);

		const enviados = updateInvestorContractDocumentState.mock.calls.map(
			(llamada) => llamada[0].visible,
		);
		expect(enviados).toEqual([true, false]);
	});

	test("dos escrituras del mismo contrato no se cruzan: la segunda lee lo último", async () => {
		contrato = { ...FIRMADO };
		let soltarLaPrimera: () => void = () => {};
		updateInvestorContractDocumentState.mockImplementationOnce(
			() =>
				new Promise((resolver) => {
					soltarLaPrimera = () => resolver(respuestaDeEstado);
				}),
		);

		const primera = espejarEstadoDeFirmaEnCartera("contrato-1");
		await Bun.sleep(0);
		// Se anula mientras la primera sigue en camino, y el anular espeja lo suyo.
		contrato = { ...FIRMADO, status: "cancelled" };
		const segunda = espejarEstadoDeFirmaEnCartera("contrato-1");
		await Bun.sleep(0);

		// La segunda espera su turno: no sale hasta que la primera termine.
		expect(updateInvestorContractDocumentState).toHaveBeenCalledTimes(1);

		soltarLaPrimera();
		await Promise.all([primera, segunda]);

		const ultima = updateInvestorContractDocumentState.mock.calls.at(-1)?.[0];
		expect(ultima).toMatchObject({ estado_firma: "cancelled", visible: false });
	});
});
