import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TEST_EMAIL } from "../lib/messaging-test-mode";
import {
	codigoEstadoCuentaCasoAHttp,
	type EstadoCuentaCasoDeps,
	esCorreoDeRelleno,
	obtenerEstadoCuentaPdf,
	sendEstadoCuentaEmail,
} from "./estado-cuenta-caso";

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

const CASO_ID = "caso-1";
const SIFCO = "SIFCO-001";
const URL_PDF = "https://r2.example/estado_cuenta_1.pdf";

function casoBase(overrides: Record<string, string | number | null> = {}) {
	return {
		numeroCreditoSifco: SIFCO,
		emailContacto: "cliente@correo.com",
		emailLead: null,
		clienteNombre: "Juan Pérez",
		vehiculoMarca: "TOYOTA",
		vehiculoModelo: "RAV4",
		vehiculoYear: 2017,
		vehiculoPlaca: "P-507GFV",
		...overrides,
	} as never;
}

function buildDeps(overrides: Partial<EstadoCuentaCasoDeps> = {}) {
	const enviar = mock(async () => ({ success: true as const, id: "re_123" }));
	const guardarLog = mock(async () => {});
	const obtenerUrl = mock(async () => ({ ok: true as const, url: URL_PDF }));
	const deps: EstadoCuentaCasoDeps = {
		cargarCaso: async () => casoBase(),
		obtenerUrl,
		obtenerAsesor: async () => ({ nombre: "Ana López", telefono: "55551234" }),
		enviar,
		guardarLog,
		...overrides,
	};
	return { deps, enviar, guardarLog, obtenerUrl };
}

describe("esCorreoDeRelleno", () => {
	test("descarta vacíos, mal formados y de ejemplo", () => {
		expect(esCorreoDeRelleno(null)).toBe(true);
		expect(esCorreoDeRelleno("")).toBe(true);
		expect(esCorreoDeRelleno("sin correo")).toBe(true);
		expect(esCorreoDeRelleno("sin-email@example.com")).toBe(true);
		expect(esCorreoDeRelleno("alguien@prueba.com")).toBe(true);
		expect(esCorreoDeRelleno("cliente@correo.com")).toBe(false);
	});
});

describe("obtenerEstadoCuentaPdf", () => {
	test("devuelve la URL del mismo PDF y el nombre del adjunto", async () => {
		const { deps, obtenerUrl } = buildDeps();
		const r = await obtenerEstadoCuentaPdf(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toEqual({
			ok: true,
			url: URL_PDF,
			nombreArchivo: `Estado-de-Cuenta-${SIFCO}.pdf`,
		});
		expect(obtenerUrl).toHaveBeenCalledWith(SIFCO);
	});

	test("sin acceso o sin caso responde CASO_NO_ENCONTRADO", async () => {
		const { deps, obtenerUrl } = buildDeps({ cargarCaso: async () => null });
		const r = await obtenerEstadoCuentaPdf(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ ok: false, codigo: "CASO_NO_ENCONTRADO" });
		expect(obtenerUrl).not.toHaveBeenCalled();
	});

	test("crédito sin movimientos", async () => {
		const { deps } = buildDeps({
			obtenerUrl: async () => ({ ok: false, motivo: "SIN_MOVIMIENTOS" }),
		});
		const r = await obtenerEstadoCuentaPdf(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ ok: false, codigo: "SIN_MOVIMIENTOS" });
	});

	test("cartera caída → ERROR_CARTERA", async () => {
		const { deps } = buildDeps({
			obtenerUrl: async () => {
				throw new Error("timeout");
			},
		});
		const r = await obtenerEstadoCuentaPdf(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ ok: false, codigo: "ERROR_CARTERA" });
	});
});

describe("sendEstadoCuentaEmail", () => {
	test("envía al correo del CRM con el PDF adjunto y deja la traza", async () => {
		const { deps, enviar, guardarLog } = buildDeps();
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toEqual({
			sent: true,
			email: "cliente@correo.com",
			emailId: "re_123",
		});
		const llamada = (enviar.mock.calls[0] as unknown[])[0] as {
			to: string[];
			asunto: string;
			html: string;
			adjuntos: Array<{ filename: string; path: string }>;
		};
		expect(llamada.to).toEqual(["cliente@correo.com"]);
		expect(llamada.adjuntos).toEqual([
			{ filename: `Estado-de-Cuenta-${SIFCO}.pdf`, path: URL_PDF },
		]);
		expect(llamada.html).toContain("Juan Pérez, le compartimos");
		expect(llamada.html).toContain("Ana López");
		expect(guardarLog).toHaveBeenCalledTimes(1);
		expect(
			(guardarLog.mock.calls[0] as unknown[])[0] as Record<string, unknown>,
		).toMatchObject({
			numeroCreditoSifco: SIFCO,
			email: "cliente@correo.com",
			createdBy: "u1",
			result: { success: true },
		});
	});

	test("el correo elegido en el modal manda sobre el del CRM", async () => {
		const { deps, enviar } = buildDeps();
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1", email: " otro@correo.com " },
			deps,
		);
		expect(r).toMatchObject({ sent: true, email: "otro@correo.com" });
		expect(
			((enviar.mock.calls[0] as unknown[])[0] as { to: string[] }).to,
		).toEqual(["otro@correo.com"]);
	});

	test("si el caso tiene un correo de relleno usa el del lead", async () => {
		const { deps } = buildDeps({
			cargarCaso: async () =>
				casoBase({
					emailContacto: "sin-email@example.com",
					emailLead: "lead@correo.com",
				}),
		});
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ sent: true, email: "lead@correo.com" });
	});

	test("sin correo válido no genera el PDF ni envía", async () => {
		const { deps, enviar, obtenerUrl, guardarLog } = buildDeps({
			cargarCaso: async () =>
				casoBase({ emailContacto: "sin-email@example.com" }),
		});
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ sent: false, codigo: "SIN_EMAIL" });
		expect(obtenerUrl).not.toHaveBeenCalled();
		expect(enviar).not.toHaveBeenCalled();
		expect(guardarLog).not.toHaveBeenCalled();
	});

	test("en modo prueba va al correo de pruebas y guarda el destino real", async () => {
		process.env.TEST_MESSAGE = "true";
		const { deps, enviar, guardarLog } = buildDeps();
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ sent: true, email: TEST_EMAIL });
		expect(
			((enviar.mock.calls[0] as unknown[])[0] as { to: string[] }).to,
		).toEqual([TEST_EMAIL]);
		expect(
			(guardarLog.mock.calls[0] as unknown[])[0] as Record<string, unknown>,
		).toMatchObject({
			result: {
				providerResponse: { testMode: true, realTarget: "cliente@correo.com" },
			},
		});
	});

	test("falla de Resend → ERROR_ENVIO con traza fallida", async () => {
		const { deps, guardarLog } = buildDeps({
			enviar: async () => ({ success: false, error: { message: "rate" } }),
		});
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({ sent: false, codigo: "ERROR_ENVIO" });
		expect(
			(guardarLog.mock.calls[0] as unknown[])[0] as Record<string, unknown>,
		).toMatchObject({ result: { success: false } });
	});

	test("cartera sin documento → no envía y deja la traza fallida", async () => {
		const { deps, enviar, guardarLog } = buildDeps({
			obtenerUrl: async () => ({
				ok: false,
				motivo: "CREDITO_NO_ESTA_EN_CARTERA",
			}),
		});
		const r = await sendEstadoCuentaEmail(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);
		expect(r).toMatchObject({
			sent: false,
			codigo: "CREDITO_NO_ESTA_EN_CARTERA",
		});
		expect(enviar).not.toHaveBeenCalled();
		expect(guardarLog).toHaveBeenCalledTimes(1);
	});
});

describe("codigoEstadoCuentaCasoAHttp", () => {
	test("mapea los códigos de negocio", () => {
		expect(codigoEstadoCuentaCasoAHttp("CASO_NO_ENCONTRADO")).toBe("NOT_FOUND");
		expect(codigoEstadoCuentaCasoAHttp("SIN_EMAIL")).toBe("BAD_REQUEST");
		expect(codigoEstadoCuentaCasoAHttp("SIN_MOVIMIENTOS")).toBe("BAD_REQUEST");
		expect(codigoEstadoCuentaCasoAHttp("ERROR_ENVIO")).toBe(
			"INTERNAL_SERVER_ERROR",
		);
	});
});
