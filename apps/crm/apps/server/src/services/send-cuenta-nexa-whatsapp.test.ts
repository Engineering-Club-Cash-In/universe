import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	construirMensajeCuentaNexa,
	type CuentaNexaWhatsappDeps,
	sendCuentaNexaWhatsapp,
} from "./send-cuenta-nexa-whatsapp";

const original = process.env.TEST_MESSAGE;
beforeEach(() => {
	process.env.TEST_MESSAGE = "false";
});
afterEach(() => {
	if (original === undefined) delete process.env.TEST_MESSAGE;
	else process.env.TEST_MESSAGE = original;
});

const params = {
	numeroSifco: "01010214100000",
	token: "32200100000002",
	asesorNombre: "Carlos Ruiz",
	asesorTelefono: "41234567",
};

function deps(over: Partial<CuentaNexaWhatsappDeps> = {}) {
	const enviados: { phone: string; message: string }[] = [];
	const logs: { plantillaId: string }[] = [];
	const d: CuentaNexaWhatsappDeps = {
		codigoYaEnviado: async () => false,
		buscarCliente: async () => ({
			telefono: "30295849 / 41674626",
			nombre: "Ana López",
		}),
		obtenerUsuarioSistema: async () => "sup-1",
		obtenerAsesor: async () => null,
		enviar: (async (p: { phone: string; message: string }) => {
			enviados.push(p);
			return { success: true, templateMessageId: "m-1" };
		}) as never,
		guardarLog: (async (p: { plantillaId: string }) => {
			logs.push(p);
		}) as never,
		...over,
	};
	return { d, enviados, logs };
}

describe("sendCuentaNexaWhatsapp", () => {
	test("manda el código en 3 bloques al primer teléfono y lo registra", async () => {
		const { d, enviados, logs } = deps();
		const r = await sendCuentaNexaWhatsapp(params, d);
		expect(r).toEqual({
			sent: true,
			templateMessageId: "m-1",
			telefono: "30295849",
		});
		expect(enviados[0]?.message.split("\n\n")).toHaveLength(3);
		expect(enviados[0]?.message).toContain("*32200100000002*");
		expect(enviados[0]?.message).toContain(
			"comuníquese con su asesor Carlos Ruiz al 41234567",
		);
		expect(logs[0]?.plantillaId).toBe("cuenta_nexa");
	});

	test("sin cliente o sin teléfono no envía", async () => {
		const sinCliente = deps({ buscarCliente: async () => null });
		expect((await sendCuentaNexaWhatsapp(params, sinCliente.d)).sent).toBe(
			false,
		);
		const sinTel = deps({
			buscarCliente: async () => ({ telefono: "123", nombre: "Ana" }),
		});
		const r = await sendCuentaNexaWhatsapp(params, sinTel.d);
		expect(r).toMatchObject({ sent: false, codigo: "SIN_TELEFONO" });
		expect(sinTel.enviados).toHaveLength(0);
	});

	test("si el código ya salió (en la bienvenida o antes) no se repite", async () => {
		const { d, enviados } = deps({ codigoYaEnviado: async () => true });
		expect(await sendCuentaNexaWhatsapp(params, d)).toEqual({
			sent: true,
			yaEnviado: true,
		});
		expect(enviados).toHaveLength(0);
	});

	test("un fallo de WhatsApp vuelve como ERROR_ENVIO", async () => {
		const { d } = deps({
			enviar: (async () => ({ success: false, error: "x" })) as never,
		});
		expect(await sendCuentaNexaWhatsapp(params, d)).toMatchObject({
			sent: false,
			codigo: "ERROR_ENVIO",
		});
	});
});

test("construirMensajeCuentaNexa sin nombre usa saludo genérico", () => {
	expect(
		construirMensajeCuentaNexa(
			"",
			"1",
			"Ante cualquier consulta, comuníquese con su asesor.",
		),
	).toStartWith("Estimado(a) cliente:");
});
