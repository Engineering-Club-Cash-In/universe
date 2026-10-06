import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let fila: Record<string, unknown> | undefined;
const enviados: { phone: string; message: string }[] = [];

const cadena = {
	from: () => cadena,
	leftJoin: () => cadena,
	where: () => cadena,
	limit: async () => (fila ? [fila] : []),
};
mock.module("../db", () => ({ db: { select: () => cadena } }));
mock.module("./cartera-back-integration", () => ({
	isCarteraBackEnabled: () => true,
}));
mock.module("./cartera-back-client", () => ({
	carteraBackClient: {
		getCredito: async () => ({
			usuario: { nombre: "ana lópez" },
			credito: { cuota: "1,500.00" },
			asesor: { nombre: "Carlos Ruiz", telefono: "41234567" },
			cuotasPendientes: [{ fecha_vencimiento: "2026-11-05" }],
		}),
	},
}));
mock.module("../lib/cobros-send-log", () => ({
	persistCobrosSendLog: async () => {},
}));
mock.module("../lib/simpletech", () => ({
	sendWhatsappTemplate: async (p: { phone: string; message: string }) => {
		enviados.push(p);
		return { success: true, templateMessageId: "m-1" };
	},
}));

const { sendWelcomeMessage } = await import("./send-welcome-message");
const { getTestPhone } = await import("../lib/messaging-test-mode");

const entorno = { ...process.env };
beforeEach(() => {
	enviados.length = 0;
	process.env.BIENVENIDA_WHATSAPP_ENABLED = "true";
	fila = {
		leadPhone: null,
		numeroSifco: "01010214100000",
		diaPagoMensual: 5,
		insuranceProvider: "gyt",
	};
});
afterEach(() => {
	process.env = { ...entorno };
});

describe("sendWelcomeMessage", () => {
	test("con TEST_MESSAGE sale al número de prueba aunque el lead no tenga teléfono", async () => {
		process.env.TEST_MESSAGE = "true";
		const r = await sendWelcomeMessage({
			opportunityId: "op-1",
			userId: "u-1",
			cuentaNexa: "32200100000002",
		});
		expect(r.sent).toBe(true);
		expect(enviados[0]?.phone).toBe(getTestPhone());
		expect(enviados[0]?.message).toContain("Seguro GYT");
		expect(enviados[0]?.message).toContain("*32200100000002*");
	});

	test("sin TEST_MESSAGE y sin teléfono se omite", async () => {
		process.env.TEST_MESSAGE = "false";
		const r = await sendWelcomeMessage({
			opportunityId: "op-1",
			userId: "u-1",
		});
		expect(r).toMatchObject({
			sent: false,
			skipped: true,
			reason: "sin_telefono",
		});
		expect(enviados).toHaveLength(0);
	});
});
