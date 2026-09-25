import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.WEETRUST_RELAY_SECRET = "secreto-de-prueba";

/** Lo que WeeTrust dice ahora, cuando el CRM le pregunta. */
let enWeeTrust: Record<string, unknown> | Error = {};

const sincronizarEstadoDeFirma = mock(
	async (_id: string, _estado: unknown, _opciones: unknown) => undefined,
);
const consultarEstadoFirma = mock(async (_documentID: string) => {
	if (enWeeTrust instanceof Error) throw enWeeTrust;
	return enWeeTrust;
});

mock.module("../lib/contrato-estado-firma", () => ({
	contratoPorDocumentID: async (documentID: string) =>
		documentID === "doc-1"
			? { id: "contrato-1", contractType: "reconocimiento_deuda" }
			: null,
	sincronizarEstadoDeFirma,
}));
mock.module("../services/legal-docs-api", () => ({ consultarEstadoFirma }));

const { default: app } = await import("./weetrust-status");

/** La foto de antes de "pedir que se identifique de nuevo": Ana firmada. */
const FOTO_VIEJA = {
	documentID: "doc-1",
	status: "PENDING",
	signatories: [
		{
			emailID: "ana@ejemplo.com",
			isSigned: true,
			signingUrl: "https://app.weetrust.mx/signatory/doc-1/viejo",
		},
	],
};

function avisar(cuerpo: unknown) {
	return app.request("/", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-weetrust-relay-secret": "secreto-de-prueba",
		},
		body: JSON.stringify(cuerpo),
	});
}

beforeEach(() => {
	sincronizarEstadoDeFirma.mockClear();
	consultarEstadoFirma.mockClear();
	enWeeTrust = {
		documentID: "doc-1",
		status: "PENDING",
		signatories: [
			{
				emailID: "ana@ejemplo.com",
				isSigned: false,
				signingUrl: "https://app.weetrust.mx/signatory/doc-1/nuevo",
			},
		],
	};
});

describe("aviso de estado de firma", () => {
	test("escribe lo que WeeTrust dice ahora, no la foto que trae el aviso", async () => {
		const antes = Date.now();
		const res = await avisar(FOTO_VIEJA);

		expect(res.status).toBe(200);
		expect(consultarEstadoFirma).toHaveBeenCalledWith("doc-1");

		const [id, estado, opciones] = sincronizarEstadoDeFirma.mock.calls[0];
		expect(id).toBe("contrato-1");
		expect(estado).toEqual(enWeeTrust);
		// Con la hora de la consulta: así no pisa a quien cambió después.
		const { observadoEn } = opciones as { observadoEn: Date };
		expect(observadoEn.getTime()).toBeGreaterThanOrEqual(antes);
	});

	test("si WeeTrust no contesta, no escribe nada", async () => {
		enWeeTrust = new Error("WeeTrust no responde");

		const res = await avisar(FOTO_VIEJA);

		expect(res.status).toBe(502);
		expect(sincronizarEstadoDeFirma).not.toHaveBeenCalled();
	});

	test("un documento que no es nuestro se ignora sin preguntar", async () => {
		const res = await avisar({ ...FOTO_VIEJA, documentID: "doc-ajeno" });

		expect(res.status).toBe(200);
		expect(consultarEstadoFirma).not.toHaveBeenCalled();
		expect(sincronizarEstadoDeFirma).not.toHaveBeenCalled();
	});
});
