import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.SIMPLETECH_BASE_URL = "https://simpletech.test";
process.env.SIMPLETECH_USERNAME = "u";
process.env.SIMPLETECH_PASSWORD = "p";
process.env.CCI_BOT_NUMBER = "50200000000";
delete process.env.TEST_MESSAGE;

const sendTemplate = mock();

mock.module("@repo/simpletech", () => ({
	SimpleTechClient: class {
		sendTemplate = sendTemplate;
	},
}));

const { sendWhatsappTemplateBatch } = await import("./simpletech");

const header = { type: "image" as const, url: "https://x.test/img.jpg" };
const mensaje = "Juan.\nLínea 2\n\nSegundo bloque\n\nTercero";

beforeEach(() => {
	sendTemplate.mockReset();
	sendTemplate.mockResolvedValue({
		success: true,
		results: [{ number: "50255550001", templateMessageId: "1", error: "" }],
		failed: [],
	});
});

describe("sendWhatsappTemplateBatch con adjunto", () => {
	test("usa el template indicado, header de imagen y un párrafo por variable sin saltos de línea", async () => {
		await sendWhatsappTemplateBatch({
			recipients: [{ phone: "55550001", message: mensaje }],
			adjunto: { templateName: "mensaje2image", header, parametros: 3 },
		});

		const request = sendTemplate.mock.calls[0][0];
		expect(request.templateName).toBe("mensaje2image");
		expect(request.messages[0].body).toEqual([
			"Juan. Línea 2",
			"Segundo bloque",
			"Tercero",
		]);
		expect(request.messages[0].header).toEqual(header);
	});

	test("con más párrafos que variables, el excedente se une con espacio y no deja saltos de línea", async () => {
		await sendWhatsappTemplateBatch({
			recipients: [
				{ phone: "55550001", message: `${mensaje}\n\nCuarto\ncon salto` },
			],
			adjunto: { templateName: "mensaje2image", header, parametros: 3 },
		});

		const body = sendTemplate.mock.calls[0][0].messages[0].body;
		expect(body).toEqual([
			"Juan. Línea 2",
			"Segundo bloque",
			"Tercero Cuarto con salto",
		]);
		for (const parametro of body) expect(parametro).not.toContain("\n");
	});

	test("sin adjunto sigue partiendo por párrafos y sin header", async () => {
		await sendWhatsappTemplateBatch({
			recipients: [{ phone: "55550001", message: mensaje }],
		});

		const request = sendTemplate.mock.calls[0][0];
		expect(request.templateName).toBe("mensaje3parametro");
		expect(request.messages[0].body).toHaveLength(3);
		expect(request.messages[0].header).toBeUndefined();
	});
});
