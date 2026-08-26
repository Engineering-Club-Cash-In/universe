import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	construirMensajePagaloLinks,
	type SendPagaloLinksWhatsappDeps,
	sendPagaloLinksWhatsapp,
} from "./send-pagalo-links-whatsapp";

const originalTestMessage = process.env.TEST_MESSAGE;

beforeEach(() => {
	process.env.TEST_MESSAGE = "false";
});

afterEach(() => {
	if (originalTestMessage === undefined) {
		delete process.env.TEST_MESSAGE;
	} else {
		process.env.TEST_MESSAGE = originalTestMessage;
	}
});

const SIFCO = "SIFCO-001";
const TELEFONO = "50230295849";
const CREATED_BY = "user-1";

function baseParams(
	overrides: Partial<Parameters<typeof sendPagaloLinksWhatsapp>[0]> = {},
) {
	return {
		numeroSifco: SIFCO,
		identificadorCredito: `crédito ${SIFCO}`,
		telefono: TELEFONO,
		clienteNombre: "Juan Pérez",
		links: [
			{
				linkType: "CAPITAL" as const,
				paymentUrl: "https://s.pagalodev.com/capital",
			},
			{
				linkType: "MORA_INTERES" as const,
				paymentUrl: "https://s.pagalodev.com/mora",
			},
		],
		createdBy: CREATED_BY,
		...overrides,
	};
}

function buildDeps(overrides: Partial<SendPagaloLinksWhatsappDeps> = {}): {
	deps: SendPagaloLinksWhatsappDeps;
	calls: { enviar: number; guardarLog: number };
	mensajesEnviados: string[];
	telefonosEnviados: string[];
} {
	const calls = { enviar: 0, guardarLog: 0 };
	const mensajesEnviados: string[] = [];
	const telefonosEnviados: string[] = [];

	const deps: SendPagaloLinksWhatsappDeps = {
		enviar: mock(async (params: any) => {
			calls.enviar++;
			mensajesEnviados.push(params.message);
			telefonosEnviados.push(params.phone);
			return {
				success: true,
				templateMessageId: "msg-123",
				providerRequest: { fake: true },
				providerResponse: { fake: true },
			};
		}),
		guardarLog: mock(async (_params: any) => {
			calls.guardarLog++;
		}),
		...overrides,
	};

	return { deps, calls, mensajesEnviados, telefonosEnviados };
}

describe("construirMensajePagaloLinks", () => {
	test("dos links: CAPITAL siempre 'Pago 1 de 2' sin importar el orden del array", () => {
		const invertido = construirMensajePagaloLinks("Juan", `crédito ${SIFCO}`, [
			{ linkType: "MORA_INTERES", paymentUrl: "https://s.pagalodev.com/mora" },
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" },
		]);
		expect(invertido).toContain("Pago 1 de 2: https://s.pagalodev.com/capital");
		expect(invertido).toContain("Pago 2 de 2: https://s.pagalodev.com/mora");
	});

	test("un solo link: etiqueta 'Pago' a secas", () => {
		const mensaje = construirMensajePagaloLinks("Juan", `crédito ${SIFCO}`, [
			{ linkType: "MORA_INTERES", paymentUrl: "https://s.pagalodev.com/mora" },
		]);
		expect(mensaje).toContain("Pago: https://s.pagalodev.com/mora");
	});

	test("D-04: nunca nombra mora, interés ni capital en el texto visible", () => {
		const mensaje = construirMensajePagaloLinks("Juan", `crédito ${SIFCO}`, [
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/atkCzHTwT9" },
			{
				linkType: "MORA_INTERES",
				paymentUrl: "https://s.pagalodev.com/xk92JqLwR3",
			},
		]);
		expect(mensaje.toLowerCase()).not.toContain("capital");
		expect(mensaje.toLowerCase()).not.toContain("mora");
		expect(mensaje.toLowerCase()).not.toContain("interes");
		expect(mensaje.toLowerCase()).not.toContain("interés");
	});
});

describe("sendPagaloLinksWhatsapp", () => {
	test("sin links: se omite sin llamar a SimpleTech", async () => {
		const { deps, calls } = buildDeps();

		const r = await sendPagaloLinksWhatsapp(baseParams({ links: [] }), deps);

		expect(r).toEqual({ sent: false, skipped: true, reason: "sin_links" });
		expect(calls.enviar).toBe(0);
		expect(calls.guardarLog).toBe(0);
	});

	test("envía un solo mensaje con ambos links y registra el log", async () => {
		const { deps, calls, mensajesEnviados, telefonosEnviados } = buildDeps();

		const r = await sendPagaloLinksWhatsapp(baseParams(), deps);

		expect(r).toMatchObject({ sent: true, templateMessageId: "msg-123" });
		expect(calls.enviar).toBe(1);
		expect(calls.guardarLog).toBe(1);
		expect(mensajesEnviados[0]).toContain("https://s.pagalodev.com/capital");
		expect(mensajesEnviados[0]).toContain("https://s.pagalodev.com/mora");
		expect(telefonosEnviados).toEqual([TELEFONO]);
	});

	test("fallo de SimpleTech: resultado tipado, no lanza excepción", async () => {
		const { deps } = buildDeps({
			enviar: mock(async () => ({
				success: false as const,
				error: "SimpleTech caído",
			})),
		});

		const r = await sendPagaloLinksWhatsapp(baseParams(), deps);

		expect(r).toEqual({ sent: false, error: "SimpleTech caído" });
	});

	test("enviar lanza excepción: nunca propaga, devuelve resultado tipado", async () => {
		const { deps } = buildDeps({
			enviar: mock(async () => {
				throw new Error("timeout de red");
			}),
		});

		const r = await sendPagaloLinksWhatsapp(baseParams(), deps);

		expect(r).toMatchObject({ sent: false, error: "timeout de red" });
	});
});
