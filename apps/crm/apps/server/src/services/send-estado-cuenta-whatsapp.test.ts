import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getTestPhone } from "../lib/messaging-test-mode";
import {
	construirMensajeEstadoCuenta,
	type EstadoCuentaDeps,
	sendEstadoCuentaWhatsapp,
} from "./send-estado-cuenta-whatsapp";

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

function casoBase(overrides: Partial<Record<string, string | null>> = {}) {
	return {
		numeroCreditoSifco: SIFCO,
		telefonoPrincipal: "30295849",
		telefonoAlternativo: null,
		clienteNombre: "Juan Pérez",
		vehiculoMarca: "TOYOTA",
		vehiculoModelo: "RAV4",
		vehiculoYear: 2017,
		vehiculoPlaca: "P-507GFV",
		...overrides,
	};
}

function buildDeps(overrides: Partial<EstadoCuentaDeps> = {}): {
	deps: EstadoCuentaDeps;
	calls: {
		cargarCaso: number;
		obtenerUrl: number;
		enviar: number;
		guardarLog: number;
	};
} {
	const calls = { cargarCaso: 0, obtenerUrl: 0, enviar: 0, guardarLog: 0 };

	const deps: EstadoCuentaDeps = {
		cargarCaso: mock(async (_id: string) => {
			calls.cargarCaso++;
			return casoBase();
		}),
		obtenerUrl: mock(async (_sifco: string) => {
			calls.obtenerUrl++;
			return {
				ok: true,
				url: "https://r2.example.com/estado_cuenta.pdf",
			} as const;
		}),
		obtenerAsesor: mock(async () => null),
		enviar: mock(async (_params: any) => {
			calls.enviar++;
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

	return { deps, calls };
}

describe("sendEstadoCuentaWhatsapp", () => {
	test("caso inexistente: CASO_NO_ENCONTRADO, sin llamar a cartera ni a SimpleTech", async () => {
		const { deps, calls } = buildDeps({
			cargarCaso: mock(async () => null),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r).toEqual({
			sent: false,
			codigo: "CASO_NO_ENCONTRADO",
			mensaje: expect.any(String),
		} as any);
		expect(calls.obtenerUrl).toBe(0);
		expect(calls.enviar).toBe(0);
	});

	test("propaga usuario y scope al cargar caso", async () => {
		let scopeRecibido: unknown;
		const { deps } = buildDeps({
			cargarCaso: mock(async (...args: unknown[]) => {
				scopeRecibido = args[1];
				return null;
			}),
		});

		await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1", puedeVerTodos: false },
			deps,
		);

		expect(scopeRecibido).toEqual({ userId: "u1", puedeVerTodos: false });
	});

	test("cargar caso falla: ERROR_INTERNO, sin propagar excepción", async () => {
		const { deps } = buildDeps({
			cargarCaso: mock(async () => {
				throw new Error("base de datos no disponible");
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r).toMatchObject({ sent: false, codigo: "ERROR_INTERNO" });
	});

	test("caso sin numeroCreditoSifco: SIN_SIFCO, sin llamadas externas", async () => {
		const { deps, calls } = buildDeps({
			cargarCaso: mock(async () => casoBase({ numeroCreditoSifco: null })),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("SIN_SIFCO");
		expect(calls.obtenerUrl).toBe(0);
		expect(calls.enviar).toBe(0);
	});

	test("sin teléfono válido en ningún campo: SIN_TELEFONO, cero llamadas a cartera", async () => {
		const { deps, calls } = buildDeps({
			cargarCaso: mock(async () =>
				casoBase({ telefonoPrincipal: "", telefonoAlternativo: null }),
			),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("SIN_TELEFONO");
		expect(calls.obtenerUrl).toBe(0);
	});

	test("telefonoPrincipal vacío, usa el alternativo", async () => {
		const { deps } = buildDeps({
			cargarCaso: mock(async () =>
				casoBase({ telefonoPrincipal: "", telefonoAlternativo: "41674626" }),
			),
			enviar: mock(async (params: any) => {
				expect(params.phone).toBe("41674626");
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(true);
	});

	test("telefonoPrincipal con varios números separados por '/': se usa solo el primero", async () => {
		const { deps } = buildDeps({
			cargarCaso: mock(async () =>
				casoBase({ telefonoPrincipal: "30295849 / 34831060" }),
			),
			enviar: mock(async (params: any) => {
				expect(params.phone).toBe("30295849");
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(true);
	});

	test("cartera responde SIN_MOVIMIENTOS: no se envía WhatsApp y deja log failed", async () => {
		let logResult: any;
		const { deps, calls } = buildDeps({
			obtenerUrl: mock(
				async () => ({ ok: false, motivo: "SIN_MOVIMIENTOS" }) as const,
			),
			guardarLog: mock(async (params: any) => {
				logResult = params.result;
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("SIN_MOVIMIENTOS");
		expect(calls.enviar).toBe(0);
		expect(logResult.success).toBe(false);
		expect(logResult.errorMessage).toContain("todavía no tiene movimientos");
	});

	test("cartera responde CREDITO_NO_ESTA_EN_CARTERA: código distinto de SIN_MOVIMIENTOS", async () => {
		const { deps } = buildDeps({
			obtenerUrl: mock(
				async () =>
					({ ok: false, motivo: "CREDITO_NO_ESTA_EN_CARTERA" }) as const,
			),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("CREDITO_NO_ESTA_EN_CARTERA");
	});

	test("getEstadoCuentaUrl lanza (timeout/circuito abierto): ERROR_CARTERA, sin propagar la excepción", async () => {
		let logResult: any;
		const { deps } = buildDeps({
			obtenerUrl: mock(async () => {
				throw new Error("timeout de red");
			}),
			guardarLog: mock(async (params: any) => {
				logResult = params.result;
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("ERROR_CARTERA");
		expect(logResult.success).toBe(false);
		expect(logResult.errorMessage).toContain("No se pudo generar");
	});

	test("cartera OK + SimpleTech success:false: ERROR_ENVIO, log status failed con errorMessage", async () => {
		let logResult: any;
		const { deps } = buildDeps({
			enviar: mock(async () => ({
				success: false,
				error: "Template name not valid",
			})),
			guardarLog: mock(async (params: any) => {
				logResult = params.result;
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("ERROR_ENVIO");
		expect(logResult.success).toBe(false);
		expect(logResult.errorMessage).toBe("Template name not valid");
	});

	test("camino feliz: header de documento con la URL de cartera, template y bodyParams correctos", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			obtenerUrl: mock(async () => ({
				ok: true,
				url: "https://r2.example.com/estado_cuenta_SIFCO-001.pdf",
			})) as any,
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-999" };
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(true);
		expect(paramsRecibidos.templateName).toBe("mensaje_adjunto");
		expect(paramsRecibidos.bodyParams).toHaveLength(1);
		expect(paramsRecibidos.header).toEqual({
			type: "document",
			url: "https://r2.example.com/estado_cuenta_SIFCO-001.pdf",
			filename: "Estado-de-Cuenta-SIFCO-001.pdf",
		});
	});

	test("camino feliz: log con plantillaId estado_cuenta, status sent y la URL en providerResponse", async () => {
		let logParams: any;
		const { deps } = buildDeps({
			guardarLog: mock(async (params: any) => {
				logParams = params;
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(true);
		expect(logParams.plantillaId).toBe("estado_cuenta");
		expect(logParams.result.success).toBe(true);
		expect(logParams.result.providerResponse.estadoCuentaUrl).toBe(
			"https://r2.example.com/estado_cuenta.pdf",
		);
	});

	test("getEstadoCuentaUrl se llama exactamente una vez: ninguna ruta reintenta", async () => {
		const { deps, calls } = buildDeps();

		await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(calls.obtenerUrl).toBe(1);
	});

	test("TEST_MESSAGE=true: destino es TEST_PHONES[0] y el log guarda el teléfono real en realTarget", async () => {
		process.env.TEST_MESSAGE = "true";
		let enviarPhone: string | undefined;
		let logResult: any;
		const { deps } = buildDeps({
			enviar: mock(async (params: any) => {
				enviarPhone = params.phone;
				return { success: true, templateMessageId: "msg-1" };
			}),
			guardarLog: mock(async (params: any) => {
				logResult = params.result;
			}),
		});

		const r = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(r.sent).toBe(true);
		if (r.sent) expect(r.telefono).toBe(getTestPhone(0));
		expect(enviarPhone).toBe(getTestPhone(0));
		expect(logResult.providerResponse.testMode).toBe(true);
		expect(logResult.providerResponse.realTarget).toBe("30295849");
	});

	test("resuelve asesor desde cartera y lo incluye en el mensaje", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			obtenerAsesor: mock(async () => ({
				nombre: "Carlos Ruiz",
				telefono: "41234567",
			})),
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(paramsRecibidos.message).toContain("Carlos Ruiz al 41234567");
	});

	test("fallo consultando asesor no bloquea estado de cuenta y usa cierre genérico", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			obtenerAsesor: mock(async () => {
				throw new Error("cartera caída");
			}),
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		const resultado = await sendEstadoCuentaWhatsapp(
			{ casoCobroId: CASO_ID, userId: "u1" },
			deps,
		);

		expect(resultado.sent).toBe(true);
		expect(paramsRecibidos.message).toContain("comunícate con tu asesor");
	});
});

describe("construirMensajeEstadoCuenta", () => {
	test("con vehículo completo: usa marca, modelo, año y placas, sin SIFCO", () => {
		const msg = construirMensajeEstadoCuenta(
			"Juan Pérez",
			{
				marca: "TOYOTA",
				modelo: "RAV4",
				year: 2017,
				placa: "P-507GFV",
			},
			SIFCO,
		);
		expect(msg).toContain("Hola Juan Pérez");
		expect(msg).toContain("TOYOTA RAV4 2017, placas P-507GFV");
		expect(msg).not.toContain(SIFCO);
	});

	test("sin placa: conserva marca, modelo y año", () => {
		const msg = construirMensajeEstadoCuenta(
			"Juan Pérez",
			{ marca: "TOYOTA", modelo: "RAV4", year: 2017, placa: null },
			SIFCO,
		);
		expect(msg).toContain("TOYOTA RAV4 2017");
		expect(msg).not.toContain("placas");
	});

	test("sin datos de vehículo: usa SIFCO como fallback", () => {
		const msg = construirMensajeEstadoCuenta(
			null,
			{ marca: null, modelo: null, year: null, placa: null },
			SIFCO,
		);
		expect(msg).not.toContain("Hola ,");
		expect(msg.startsWith("Hola,")).toBe(true);
		expect(msg).toContain(SIFCO);
	});
});
