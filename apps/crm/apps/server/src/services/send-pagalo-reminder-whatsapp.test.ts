import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	construirMensajeRecordatorioPagalo,
	type SendPagaloReminderWhatsappDeps,
	sendPagaloReminderWhatsapp,
} from "./send-pagalo-reminder-whatsapp";

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
const CREATED_BY = "pagalo@clubcashin.com";

function baseParams(
	overrides: Partial<Parameters<typeof sendPagaloReminderWhatsapp>[0]> = {},
) {
	return {
		numeroSifco: SIFCO,
		telefono: TELEFONO,
		clienteNombre: "Juan Pérez",
		links: [
			{
				linkType: "MORA_INTERES" as const,
				paymentUrl: "https://s.pagalodev.com/mora",
			},
			{
				linkType: "CAPITAL" as const,
				paymentUrl: "https://s.pagalodev.com/capital",
			},
		],
		createdBy: CREATED_BY,
		...overrides,
	};
}

function buildDeps(overrides: Partial<SendPagaloReminderWhatsappDeps> = {}): {
	deps: SendPagaloReminderWhatsappDeps;
	calls: { enviar: number; guardarLog: number };
	mensajesEnviados: string[];
	telefonosEnviados: string[];
} {
	const calls = { enviar: 0, guardarLog: 0 };
	const mensajesEnviados: string[] = [];
	const telefonosEnviados: string[] = [];

	const deps: SendPagaloReminderWhatsappDeps = {
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

describe("construirMensajeRecordatorioPagalo", () => {
	test("dos links: explica que juntos forman saldo pendiente e identifica vehículo y placa", () => {
		const mensaje = construirMensajeRecordatorioPagalo(
			"Juan",
			SIFCO,
			[
				{ linkType: "MORA_INTERES", paymentUrl: "https://s.pagalodev.com/mora" },
				{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" },
			],
			{ marca: "TOYOTA", modelo: "RAV4", year: 2017, placa: "P-507GFV" },
		);

		expect(mensaje).toContain("saldo pendiente de tu TOYOTA RAV4 2017, placas P-507GFV");
		expect(mensaje).toContain(
			"Los siguientes pagos, en conjunto, corresponden al total de tu saldo pendiente:",
		);
		expect(mensaje).not.toContain(SIFCO);
	});

	test("un link: explica que corresponde al total del saldo pendiente", () => {
		const mensaje = construirMensajeRecordatorioPagalo(
			"Juan",
			SIFCO,
			[{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" }],
			{ marca: "TOYOTA", modelo: "RAV4", year: 2017, placa: "P-507GFV" },
		);

		expect(mensaje).toContain(
			"Este pago corresponde al total de tu saldo pendiente:",
		);
	});

	test("sin vehículo: usa SIFCO como fallback", () => {
		const mensaje = construirMensajeRecordatorioPagalo("Juan", SIFCO, [
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" },
		]);

		expect(mensaje).toContain(`saldo pendiente de tu crédito ${SIFCO}`);
	});

	test("dos links: respeta el orden de entrada (mora primero), no reordena a capital-primero", () => {
		const mensaje = construirMensajeRecordatorioPagalo("Juan", SIFCO, [
			{ linkType: "MORA_INTERES", paymentUrl: "https://s.pagalodev.com/mora" },
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" },
		]);
		expect(mensaje).toContain("Pago 1 de 2: https://s.pagalodev.com/mora");
		expect(mensaje).toContain("Pago 2 de 2: https://s.pagalodev.com/capital");
	});

	test("un solo link (capital-only, mora ya pagada): etiqueta 'Pago' a secas", () => {
		const mensaje = construirMensajeRecordatorioPagalo("Juan", SIFCO, [
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" },
		]);
		expect(mensaje).toContain("Pago: https://s.pagalodev.com/capital");
	});

	test("D-04: nunca nombra mora, interés ni capital en el texto visible", () => {
		const mensaje = construirMensajeRecordatorioPagalo("Juan", SIFCO, [
			{
				linkType: "MORA_INTERES",
				paymentUrl: "https://s.pagalodev.com/xk92JqLwR3",
			},
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/atkCzHTwT9" },
		]);
		expect(mensaje.toLowerCase()).not.toContain("capital");
		expect(mensaje.toLowerCase()).not.toContain("mora");
		expect(mensaje.toLowerCase()).not.toContain("interes");
		expect(mensaje.toLowerCase()).not.toContain("interés");
	});

	test("incluye la frase de 'si ya pagaste, ignora este mensaje'", () => {
		const mensaje = construirMensajeRecordatorioPagalo("Juan", SIFCO, [
			{ linkType: "CAPITAL", paymentUrl: "https://s.pagalodev.com/capital" },
		]);
		expect(mensaje).toContain(
			"Si ya realizaste el pago, puedes ignorar este mensaje.",
		);
	});
});

describe("sendPagaloReminderWhatsapp", () => {
	test("sin links: se omite sin llamar a SimpleTech", async () => {
		const { deps, calls } = buildDeps();

		const r = await sendPagaloReminderWhatsapp(baseParams({ links: [] }), deps);

		expect(r).toEqual({ sent: false, skipped: true, reason: "sin_links" });
		expect(calls.enviar).toBe(0);
		expect(calls.guardarLog).toBe(0);
	});

	test("envía un solo mensaje con los links pendientes y registra el log", async () => {
		const { deps, calls, mensajesEnviados, telefonosEnviados } = buildDeps();

		const r = await sendPagaloReminderWhatsapp(baseParams(), deps);

		expect(r).toMatchObject({ sent: true, templateMessageId: "msg-123" });
		expect(calls.enviar).toBe(1);
		expect(calls.guardarLog).toBe(1);
		expect(mensajesEnviados[0]).toContain("https://s.pagalodev.com/mora");
		expect(mensajesEnviados[0]).toContain("https://s.pagalodev.com/capital");
		expect(telefonosEnviados).toEqual([TELEFONO]);
	});

	test("modo prueba: redirige recordatorio al teléfono de prueba en posición 0", async () => {
		process.env.TEST_MESSAGE = "true";
		const { deps, telefonosEnviados } = buildDeps();

		await sendPagaloReminderWhatsapp(baseParams(), deps);

		expect(telefonosEnviados).toEqual(["58446376"]);
	});

	test("fallo de SimpleTech: resultado tipado, no lanza excepción", async () => {
		const { deps } = buildDeps({
			enviar: mock(async () => ({
				success: false as const,
				error: "SimpleTech caído",
			})),
		});

		const r = await sendPagaloReminderWhatsapp(baseParams(), deps);

		expect(r).toEqual({ sent: false, error: "SimpleTech caído" });
	});

	test("enviar lanza excepción: nunca propaga, devuelve resultado tipado", async () => {
		const { deps } = buildDeps({
			enviar: mock(async () => {
				throw new Error("timeout de red");
			}),
		});

		const r = await sendPagaloReminderWhatsapp(baseParams(), deps);

		expect(r).toMatchObject({ sent: false, error: "timeout de red" });
	});
});
