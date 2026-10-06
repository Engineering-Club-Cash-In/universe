import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
	celularGuatemala,
	clasificarEnvioWhatsapp,
	destinoModoPrueba,
	ordenarContactos,
} from "../lib/cartera-estado-cuenta";
import {
	type CarteraEstadoCuentaDeps,
	crearCarteraEstadoCuentaRouter,
} from "./cartera-estado-cuenta";

// Ningún test llega a SimpleTech: el envío es un espía.

process.env.CARTERA_RELAY_SECRET = "secreto-de-prueba";

describe("celularGuatemala", () => {
	test("acepta celulares de 8 dígitos con o sin 502", () => {
		expect(celularGuatemala("5844-6376")).toBe("58446376");
		expect(celularGuatemala("+502 3521 9722")).toBe("35219722");
		expect(celularGuatemala("50247705027")).toBe("47705027");
	});
	test("usa solo el primero cuando el registro trae varios", () => {
		expect(celularGuatemala("49289881, 25099248")).toBe("49289881");
		expect(celularGuatemala("46904722 / 47926862")).toBe("46904722");
	});
	test("descarta fijos, rellenos y longitudes inválidas", () => {
		expect(celularGuatemala("2250-1234")).toBeNull(); // fijo
		expect(celularGuatemala("00000000")).toBeNull();
		expect(celularGuatemala("55555555")).toBeNull();
		expect(celularGuatemala("12345678")).toBeNull();
		expect(celularGuatemala("5844637")).toBeNull();
		expect(celularGuatemala("")).toBeNull();
		expect(celularGuatemala(null)).toBeNull();
	});
});

describe("ordenarContactos", () => {
	test("orden de Cobros: caso de cobros → lead → solicitud, sin duplicados", () => {
		const r = ordenarContactos([
			{ valor: "00000000", fuente: "CASO_COBROS" },
			{ valor: "5844-6376", fuente: "CASO_COBROS" },
			{ valor: "+50258446376", fuente: "LEAD" }, // duplicado del de cobros
			{ valor: "35219722", fuente: "LEAD" },
			{ valor: "47705027", fuente: "SOLICITUD" },
		]);
		expect(r).toEqual([
			{ telefono: "+50258446376", fuente: "CASO_COBROS", sugerido: true },
			{ telefono: "+50235219722", fuente: "LEAD", sugerido: false },
			{ telefono: "+50247705027", fuente: "SOLICITUD", sugerido: false },
		]);
	});
	test("descarta los números compartidos por muchos registros", () => {
		const r = ordenarContactos(
			[
				{ valor: "30047424", fuente: "CASO_COBROS" },
				{ valor: "35219722", fuente: "LEAD" },
			],
			new Set(["30047424"]),
		);
		expect(r.map((c) => c.telefono)).toEqual(["+50235219722"]);
		expect(r[0].sugerido).toBe(true);
	});
});

describe("consultaTelefonosCompartidos", () => {
	test("suma las cuatro fuentes y cuenta por crédito distinto", async () => {
		const { PgDialect } = await import("drizzle-orm/pg-core");
		const { consultaTelefonosCompartidos } = await import("./cartera-estado-cuenta");
		const { sql, params } = new PgDialect().sqlToQuery(
			consultaTelefonosCompartidos(["54673367", "35219722"]),
		);
		for (const columna of ["l.phone", "c.telefono_principal", "c.telefono_alternativo", "a.tel_movil"]) {
			expect(sql).toContain(columna);
		}
		expect(sql).toContain("count(distinct clave)");
		expect(params).toEqual(["54673367", "35219722"]);
	});
});

describe("destinoModoPrueba (con la lista real de CRM)", () => {
	test("número de la lista de prueba → se respeta", async () => {
		const { TEST_PHONES } = await import("../lib/messaging-test-mode");
		expect(destinoModoPrueba("54673367", TEST_PHONES, "58446376")).toBe("54673367");
	});
	test("número fuera de la lista (p. ej. un cliente) → número de prueba por defecto", async () => {
		const { TEST_PHONES } = await import("../lib/messaging-test-mode");
		expect(destinoModoPrueba("35000001", TEST_PHONES, "58446376")).toBe("58446376");
	});
});

describe("clasificarEnvioWhatsapp", () => {
	test("éxito → ENVIADO con el id del proveedor", () => {
		expect(clasificarEnvioWhatsapp({ success: true, templateMessageId: "t-1" })).toEqual({
			resultado: "ENVIADO",
			mensajeId: "t-1",
		});
	});
	test("rechazo del proveedor o servicio sin configurar → NO_ENVIADO", () => {
		expect(clasificarEnvioWhatsapp({ success: false, error: "número inválido" }).resultado).toBe("NO_ENVIADO");
		expect(clasificarEnvioWhatsapp({ success: false, error: "Servicio de mensajería no configurado" }).resultado).toBe("NO_ENVIADO");
		expect(
			clasificarEnvioWhatsapp({
				success: false,
				error: "Error HTTP 400",
				providerResponse: { exception: "Error HTTP 400", errorName: "ConnectionError", statusCode: 400 },
			}).resultado,
		).toBe("NO_ENVIADO");
		expect(
			clasificarEnvioWhatsapp({
				success: false,
				error: "sendTemplate fallo",
				providerResponse: { exception: "sendTemplate fallo", errorName: "SimpleTechError" },
			}).resultado,
		).toBe("NO_ENVIADO");
	});
	test("timeout, 5xx o excepción inesperada → INCIERTO", () => {
		for (const providerResponse of [
			{ exception: "Timeout", errorName: "ConnectionError" },
			{ exception: "Error HTTP 502", errorName: "ConnectionError", statusCode: 502 },
			{ exception: "x is undefined", errorName: "TypeError" },
		]) {
			expect(clasificarEnvioWhatsapp({ success: false, error: "x", providerResponse }).resultado).toBe("INCIERTO");
		}
	});
});

describe("rutas /api/cartera/estado-cuenta", () => {
	let enviar: ReturnType<typeof mock>;
	let modoPrueba = false;
	let app: ReturnType<typeof crearCarteraEstadoCuentaRouter>;

	const deps = (): CarteraEstadoCuentaDeps => ({
		telefonosDelCredito: async (numero) =>
			numero === "01020304"
				? [
						{ valor: "30047424", fuente: "CASO_COBROS" },
						{ valor: "35219722", fuente: "LEAD" },
					]
				: [],
		telefonosCompartidos: async () => new Set(["30047424"]),
		enviarWhatsapp: enviar as unknown as CarteraEstadoCuentaDeps["enviarWhatsapp"],
		modoPrueba: () => modoPrueba,
		telefonoDePrueba: (d) => destinoModoPrueba(d, ["58446376", "54673367"], "58446376"),
	});

	beforeEach(() => {
		enviar = mock(async () => ({ success: true, templateMessageId: "t-9" }));
		modoPrueba = false;
		app = crearCarteraEstadoCuentaRouter(deps());
	});

	const pedir = (path: string, init: RequestInit = {}, secreto: string | null = "secreto-de-prueba") =>
		app.request(path, {
			...init,
			headers: {
				"Content-Type": "application/json",
				...(secreto ? { "x-cartera-relay-secret": secreto } : {}),
			},
		});

	const cuerpo = (extra: Record<string, unknown> = {}) =>
		JSON.stringify({
			intentoId: crypto.randomUUID(),
			numeroCreditoSifco: "01020304",
			telefono: "+50235219722",
			mensaje: "Hola Juan\n\nPuedes verlo aquí: https://x/ec/abc\n\nSaludos",
			...extra,
		});

	test("sin secreto o con secreto inválido → 401, sin enviar", async () => {
		expect((await pedir("/contactos?numero_sifco=01020304", {}, null)).status).toBe(401);
		expect((await pedir("/whatsapp", { method: "POST", body: cuerpo() }, "otro")).status).toBe(401);
		expect(enviar).not.toHaveBeenCalled();
	});

	test("contactos: ordenados y sin compartidos", async () => {
		const res = await pedir("/contactos?numero_sifco=01020304");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			success: true,
			contactos: [{ telefono: "+50235219722", fuente: "LEAD", sugerido: true }],
		});
	});

	test("contactos sin numero_sifco → 400", async () => {
		expect((await pedir("/contactos")).status).toBe(400);
	});

	test("whatsapp: envía al número pedido y devuelve ENVIADO", async () => {
		const res = await pedir("/whatsapp", { method: "POST", body: cuerpo() });
		const json = await res.json();
		expect(json.resultado).toBe("ENVIADO");
		expect(json.mensajeId).toBe("t-9");
		expect(json.modoPrueba).toBe(false);
		expect(enviar).toHaveBeenCalledTimes(1);
		expect((enviar.mock.calls[0] as any)[0].telefono).toBe("+50235219722");
	});

	test("whatsapp en modo prueba: se desvía al teléfono de prueba", async () => {
		modoPrueba = true;
		const json = await (await pedir("/whatsapp", { method: "POST", body: cuerpo() })).json();
		expect(json.modoPrueba).toBe(true);
		expect((enviar.mock.calls[0] as any)[0].telefono).toBe("58446376");
	});

	test("modo prueba: si el número elegido es de prueba, le llega a ese número", async () => {
		modoPrueba = true;
		const json = await (
			await pedir("/whatsapp", { method: "POST", body: cuerpo({ telefono: "+50254673367" }) })
		).json();
		expect(json.modoPrueba).toBe(true);
		expect((enviar.mock.calls[0] as any)[0].telefono).toBe("54673367");
	});

	test("mismo intentoId no manda dos mensajes", async () => {
		const intentoId = crypto.randomUUID();
		await pedir("/whatsapp", { method: "POST", body: cuerpo({ intentoId }) });
		const segundo = await (await pedir("/whatsapp", { method: "POST", body: cuerpo({ intentoId }) })).json();
		expect(enviar).toHaveBeenCalledTimes(1);
		expect(segundo.repetido).toBe(true);
	});

	test("teléfono no celular o body inválido → 400 NO_ENVIADO sin llamar al proveedor", async () => {
		const fijo = await pedir("/whatsapp", { method: "POST", body: cuerpo({ telefono: "22501234" }) });
		expect(fijo.status).toBe(400);
		expect((await fijo.json()).resultado).toBe("NO_ENVIADO");
		expect((await pedir("/whatsapp", { method: "POST", body: "{}" })).status).toBe(400);
		expect(enviar).not.toHaveBeenCalled();
	});

	test("excepción del envío → INCIERTO", async () => {
		enviar = mock(async () => {
			throw new Error("socket hang up");
		});
		app = crearCarteraEstadoCuentaRouter(deps());
		const json = await (await pedir("/whatsapp", { method: "POST", body: cuerpo() })).json();
		expect(json.resultado).toBe("INCIERTO");
	});
});
