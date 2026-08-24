import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getTestPhone } from "../lib/messaging-test-mode";
import {
	construirMensajeReciboPago,
	type ReciboPagoDeps,
	sendReciboPagoWhatsapp,
} from "./send-recibo-pago-whatsapp";

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
const PAGO_ID = 42;
const RECIBO_URL = "https://r2.example.com/recibo_pago_42.pdf";
const SUPERVISOR_ID = "user-supervisor-1";

function casoBase(
	overrides: Partial<Record<string, string | number | null>> = {},
) {
	return {
		telefonoPrincipal: "30295849",
		telefonoAlternativo: null,
		vehiculoMarca: "TOYOTA",
		vehiculoModelo: "RAV4",
		vehiculoYear: 2017,
		vehiculoPlaca: "P-507GFV",
		...overrides,
	};
}

function baseParams(
	overrides: Partial<Parameters<typeof sendReciboPagoWhatsapp>[0]> = {},
) {
	return {
		pagoId: PAGO_ID,
		numeroSifco: SIFCO,
		reciboUrl: RECIBO_URL,
		clienteNombre: "Juan Pérez",
		...overrides,
	};
}

function buildDeps(overrides: Partial<ReciboPagoDeps> = {}): {
	deps: ReciboPagoDeps;
	calls: {
		cargarCaso: number;
		obtenerUsuarioSistema: number;
		enviar: number;
		guardarLog: number;
	};
} {
	const calls = {
		cargarCaso: 0,
		obtenerUsuarioSistema: 0,
		enviar: 0,
		guardarLog: 0,
	};

	const deps: ReciboPagoDeps = {
		cargarCaso: mock(async (_sifco: string) => {
			calls.cargarCaso++;
			return casoBase();
		}),
		obtenerUsuarioSistema: mock(async () => {
			calls.obtenerUsuarioSistema++;
			return SUPERVISOR_ID;
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

describe("sendReciboPagoWhatsapp", () => {
	test("caso inexistente para el SIFCO: CASO_NO_ENCONTRADO, sin llamar a SimpleTech", async () => {
		const { deps, calls } = buildDeps({
			cargarCaso: mock(async () => null),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r).toEqual({
			sent: false,
			codigo: "CASO_NO_ENCONTRADO",
			mensaje: expect.any(String),
		} as any);
		expect(calls.enviar).toBe(0);
	});

	test("cargar caso falla: ERROR_INTERNO, sin propagar excepción", async () => {
		const { deps } = buildDeps({
			cargarCaso: mock(async () => {
				throw new Error("base de datos no disponible");
			}),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r).toMatchObject({ sent: false, codigo: "ERROR_INTERNO" });
	});

	test("busca el caso por número SIFCO recibido", async () => {
		let sifcoRecibido: unknown;
		const { deps } = buildDeps({
			cargarCaso: mock(async (sifco: string) => {
				sifcoRecibido = sifco;
				return null;
			}),
		});

		await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(sifcoRecibido).toBe(SIFCO);
	});

	test("sin teléfono válido en ningún campo: SIN_TELEFONO, cero llamadas a SimpleTech", async () => {
		const { deps, calls } = buildDeps({
			cargarCaso: mock(async () =>
				casoBase({ telefonoPrincipal: "", telefonoAlternativo: null }),
			),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("SIN_TELEFONO");
		expect(calls.enviar).toBe(0);
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

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(true);
	});

	test("sin usuario cobros_supervisor disponible: SIN_USUARIO_SISTEMA, sin enviar", async () => {
		const { deps, calls } = buildDeps({
			obtenerUsuarioSistema: mock(async () => null),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("SIN_USUARIO_SISTEMA");
		expect(calls.enviar).toBe(0);
	});

	test("buscar usuario de sistema falla: ERROR_INTERNO, sin propagar excepción", async () => {
		const { deps } = buildDeps({
			obtenerUsuarioSistema: mock(async () => {
				throw new Error("timeout de red");
			}),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r).toMatchObject({ sent: false, codigo: "ERROR_INTERNO" });
	});

	test("SimpleTech responde success:false: ERROR_ENVIO, log status failed con errorMessage", async () => {
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

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(false);
		if (!r.sent) expect(r.codigo).toBe("ERROR_ENVIO");
		expect(logResult.success).toBe(false);
		expect(logResult.errorMessage).toBe("Template name not valid");
	});

	test("camino feliz: header de documento con la URL y filename del recibo del pago", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-999" };
			}),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(true);
		expect(paramsRecibidos.templateName).toBe("mensaje_adjunto");
		expect(paramsRecibidos.bodyParams).toHaveLength(1);
		expect(paramsRecibidos.header).toEqual({
			type: "document",
			url: RECIBO_URL,
			filename: `Recibo-Pago-${PAGO_ID}.pdf`,
		});
	});

	test("camino feliz: log con plantillaId recibo_pago, createdBy del usuario de sistema y pagoId en providerResponse", async () => {
		let logParams: any;
		const { deps } = buildDeps({
			guardarLog: mock(async (params: any) => {
				logParams = params;
			}),
		});

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(true);
		expect(logParams.plantillaId).toBe("recibo_pago");
		expect(logParams.createdBy).toBe(SUPERVISOR_ID);
		expect(logParams.result.success).toBe(true);
		expect(logParams.result.providerResponse.pagoId).toBe(PAGO_ID);
		expect(logParams.result.providerResponse.reciboUrl).toBe(RECIBO_URL);
	});

	test("nunca reintenta el envío: enviar se llama exactamente una vez", async () => {
		const { deps, calls } = buildDeps();

		await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(calls.enviar).toBe(1);
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

		const r = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(r.sent).toBe(true);
		if (r.sent) expect(r.telefono).toBe(getTestPhone(2));
		expect(enviarPhone).toBe(getTestPhone(2));
		expect(logResult.providerResponse.testMode).toBe(true);
		expect(logResult.providerResponse.realTarget).toBe("30295849");
	});

	test("con datos de vehículo: el mensaje usa marca/modelo/año/placa, no el SIFCO", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(paramsRecibidos.message).toContain(
			"TOYOTA RAV4 2017, placas P-507GFV",
		);
		expect(paramsRecibidos.message).not.toContain(SIFCO);
	});

	test("sin datos de vehículo: el mensaje cae al SIFCO como identificador", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			cargarCaso: mock(async () =>
				casoBase({
					vehiculoMarca: null,
					vehiculoModelo: null,
					vehiculoYear: null,
					vehiculoPlaca: null,
				}),
			),
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(paramsRecibidos.message).toContain(SIFCO);
	});

	test("con numeroCuota y asesor: el mensaje incluye la cuota y el teléfono del asesor, no el genérico", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		await sendReciboPagoWhatsapp(
			baseParams({
				numeroCuota: 7,
				asesorNombre: "Carlos Ruiz",
				asesorTelefono: "41234567",
			}),
			deps,
		);

		expect(paramsRecibidos.message).toContain("(cuota 7)");
		expect(paramsRecibidos.message).toContain(
			"llama a tu asesor Carlos Ruiz al 41234567",
		);
		expect(paramsRecibidos.message).not.toContain("comunícate con tu asesor");
	});

	test("sin asesor: cae al cierre genérico 'comunícate con tu asesor'", async () => {
		let paramsRecibidos: any;
		const { deps } = buildDeps({
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		await sendReciboPagoWhatsapp(baseParams({ asesorTelefono: null }), deps);

		expect(paramsRecibidos.message).toContain("comunícate con tu asesor");
	});

	test("asesor recibido incompleto: consulta cartera y usa contacto completo", async () => {
		let paramsRecibidos: any;
		const obtenerAsesor = mock(async () => ({
			nombre: "Ana Pérez",
			telefono: "49998888",
		}));
		const { deps } = buildDeps({
			obtenerAsesor,
			enviar: mock(async (params: any) => {
				paramsRecibidos = params;
				return { success: true, templateMessageId: "msg-1" };
			}),
		});

		await sendReciboPagoWhatsapp(
			baseParams({ asesorNombre: "Carlos", asesorTelefono: null }),
			deps,
		);

		expect(obtenerAsesor).toHaveBeenCalledWith(SIFCO);
		expect(paramsRecibidos.message).toContain("Ana Pérez al 49998888");
	});

	test("asesor recibido completo: no consulta cartera", async () => {
		const obtenerAsesor = mock(async () => ({
			nombre: "Ignorado",
			telefono: "00000000",
		}));
		const { deps } = buildDeps({ obtenerAsesor });

		await sendReciboPagoWhatsapp(
			baseParams({ asesorNombre: "Carlos Ruiz", asesorTelefono: "41234567" }),
			deps,
		);

		expect(obtenerAsesor).not.toHaveBeenCalled();
	});

	test("fallo consultando asesor no bloquea recibo y usa cierre genérico", async () => {
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

		const resultado = await sendReciboPagoWhatsapp(baseParams(), deps);

		expect(resultado.sent).toBe(true);
		expect(paramsRecibidos.message).toContain("comunícate con tu asesor");
	});
});

describe("construirMensajeReciboPago", () => {
	test("con vehículo completo: usa marca, modelo, año y placas, sin SIFCO", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: "TOYOTA", modelo: "RAV4", year: 2017, placa: "P-507GFV" },
			SIFCO,
		);
		expect(msg).toContain("Hola Juan Pérez");
		expect(msg).toContain("TOYOTA RAV4 2017, placas P-507GFV");
		expect(msg).not.toContain(SIFCO);
	});

	test("sin placa: conserva marca, modelo y año", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: "TOYOTA", modelo: "RAV4", year: 2017, placa: null },
			SIFCO,
		);
		expect(msg).toContain("TOYOTA RAV4 2017");
		expect(msg).not.toContain("placas");
	});

	test("sin datos de vehículo: usa SIFCO como fallback", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: null, modelo: null, year: null, placa: null },
			SIFCO,
		);
		expect(msg).toContain(SIFCO);
	});

	test("con numeroCuota: agrega '(cuota N)' tras el identificador", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: "TOYOTA", modelo: "RAV4", year: 2017, placa: "P-507GFV" },
			SIFCO,
			{ numeroCuota: 7 },
		);
		expect(msg).toContain("placas P-507GFV (cuota 7)");
	});

	test("con asesor completo: cierre invita a llamar al asesor, no genérico", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: null, modelo: null, year: null, placa: null },
			SIFCO,
			{ asesor: { nombre: "Carlos Ruiz", telefono: "41234567" } },
		);
		expect(msg).toContain("llama a tu asesor Carlos Ruiz al 41234567");
		expect(msg).not.toContain("comunícate con tu asesor");
	});

	test("sin asesor completo: cierre genérico", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: null, modelo: null, year: null, placa: null },
			SIFCO,
			{ asesor: null },
		);
		expect(msg).toContain("comunícate con tu asesor");
	});

	test("sin asesor: cierre genérico 'comunícate con tu asesor'", () => {
		const msg = construirMensajeReciboPago(
			"Juan Pérez",
			{ marca: null, modelo: null, year: null, placa: null },
			SIFCO,
		);
		expect(msg).toContain("comunícate con tu asesor");
	});
});
