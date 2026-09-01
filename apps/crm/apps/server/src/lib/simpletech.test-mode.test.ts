/**
 * La puerta de salida respeta `TEST_MESSAGE`.
 *
 * `lib/simpletech.ts` es el ÚNICO lugar del server desde donde sale un
 * WhatsApp (nadie más instancia `SimpleTechClient`). Estas pruebas verifican
 * lo que se le manda al proveedor, que es lo que de verdad decide a qué
 * teléfono suena el mensaje — no lo que el emisor creía estar mandando.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const enviados: { number: string }[] = [];

mock.module("@repo/simpletech", () => ({
	SimpleTechClient: class {
		async sendTemplate(req: { messages: { number: string }[] }) {
			enviados.push(...req.messages);
			return {
				success: true,
				results: req.messages.map((m, i) => ({
					templateMessageId: `id-${i}`,
					number: m.number,
				})),
				failed: [],
			};
		}
	},
}));

const { sendWhatsappTemplate, sendWhatsappTemplateBatch } = await import(
	"./simpletech"
);
const { esTelefonoDePrueba } = await import("./messaging-test-mode");

const previo = { ...process.env };
const CLIENTE_REAL = "45678901";

beforeEach(() => {
	enviados.length = 0;
	process.env.TEST_MESSAGE = "true";
	process.env.SIMPLETECH_BASE_URL = "https://ejemplo.invalido";
	process.env.SIMPLETECH_USERNAME = "u";
	process.env.SIMPLETECH_PASSWORD = "p";
});

afterEach(() => {
	process.env = { ...previo };
});

describe("TEST_MESSAGE en la puerta de salida", () => {
	test("envío individual: al proveedor NUNCA le llega el número del cliente", async () => {
		await sendWhatsappTemplate({ phone: CLIENTE_REAL, message: "hola" });
		expect(enviados).toHaveLength(1);
		expect(enviados[0].number).not.toBe(`+502${CLIENTE_REAL}`);
		expect(esTelefonoDePrueba(enviados[0].number)).toBe(true);
	});

	test("el caso que se había escapado: un emisor que NO redirige queda cubierto igual", async () => {
		// `bot-cobros/eventos-pago.ts` (aviso de rechazo) llama así, sin tocar
		// modo prueba. Antes esto salía al cliente real.
		await sendWhatsappTemplate({
			phone: CLIENTE_REAL,
			message: "Tu boleta no era válida",
			logPrefix: "[BotCobrosEventos]",
		});
		expect(esTelefonoDePrueba(enviados[0].number)).toBe(true);
	});

	test("con el modo apagado sí sale al cliente real", async () => {
		process.env.TEST_MESSAGE = "false";
		await sendWhatsappTemplate({ phone: CLIENTE_REAL, message: "hola" });
		expect(enviados[0].number).toBe(`+502${CLIENTE_REAL}`);
	});

	test("batch: ningún destinatario real llega al proveedor, y no se colapsan", async () => {
		const reales = ["45678901", "45678902", "45678903"];
		await sendWhatsappTemplateBatch({
			recipients: reales.map((phone) => ({ phone, message: "hola" })),
		});
		expect(enviados).toHaveLength(3);
		for (const m of enviados) {
			expect(esTelefonoDePrueba(m.number)).toBe(true);
			expect(reales.some((r) => m.number.endsWith(r))).toBe(false);
		}
		// Rotan: si colapsaran en uno solo, el dedup del batch los trataría
		// como un mismo destinatario duplicado.
		expect(new Set(enviados.map((m) => m.number)).size).toBe(3);
	});
});
