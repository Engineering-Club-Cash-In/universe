/**
 * El historial de interacciones (CB-110): lo que cuidan estas pruebas es la
 * allowlist (D-42) y la regla general (D-41) — que un endpoint nuevo caiga al
 * historial solo, y que la PII no pueda caer ni queriendo.
 *
 * `persistirInteraccion` necesita base de datos y se probó contra dev; acá va
 * `armarInteraccion`, que es donde viven todas las reglas.
 */

import { describe, expect, test } from "bun:test";
import {
	accionDeRuta,
	armarInteraccion,
	enmascarar,
	RUTAS_SIN_HISTORIAL,
} from "./historial";

const IDENTIDAD = {
	leadId: "11111111-1111-1111-1111-111111111111",
	coDebtorId: null,
};
const REFERENCIA = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";

describe("enmascarar", () => {
	test("deja solo los últimos 4", () => {
		expect(enmascarar("1234567891234")).toBe("*********1234");
	});

	test("un dato corto no revela nada", () => {
		expect(enmascarar("123")).toBe("***");
	});
});

describe("la regla general: toda ruta del bot cae al historial", () => {
	test("las 6 rutas conocidas tienen nombre propio", () => {
		expect(accionDeRuta("/api/bot/cobros/buscar-cliente")).toBe(
			"buscar_cliente",
		);
		expect(accionDeRuta("/api/bot/cobros/creditos")).toBe("listar_creditos");
		expect(accionDeRuta("/api/bot/cobros/credito/info")).toBe("menu_credito");
		expect(accionDeRuta("/api/bot/cobros/credito/estado-cuenta")).toBe(
			"estado_cuenta",
		);
		expect(accionDeRuta("/api/bot/cobros/boleta/leer")).toBe("boleta_leer");
		expect(accionDeRuta("/api/bot/cobros/boleta/confirmar")).toBe(
			"boleta_confirmar",
		);
	});

	test("una ruta FUTURA se registra sola, con la acción derivada", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/pago/link",
			cuerpo: { referencia: REFERENCIA, numeroSifco: "123456" },
			estado: 200,
			respuesta: { success: true, data: { url: "https://pagalo.example" } },
			identidad: null,
		});

		expect(interaccion).not.toBeNull();
		expect(interaccion?.accion).toBe("pago_link");
		expect(interaccion?.exito).toBe(true);
		expect(interaccion?.numeroSifco).toBe("123456");
		// Sin curador no se copia NADA del cuerpo ni de la respuesta.
		expect(interaccion?.detalle).toEqual({});
	});

	// Codex (PR #1411): el comodín envuelve también a la autenticación. Una
	// petición rechazada por API key —aunque traiga una referencia real— no es
	// una interacción del cliente y no puede ensuciar su línea de tiempo.
	test("un rechazo de la autenticación NO se registra", () => {
		for (const codigo of ["NO_AUTORIZADO", "SERVICIO_NO_DISPONIBLE"]) {
			const interaccion = armarInteraccion({
				ruta: "/api/bot/cobros/credito/info",
				cuerpo: { referencia: REFERENCIA, numeroSifco: "115900" },
				estado: codigo === "NO_AUTORIZADO" ? 401 : 503,
				respuesta: {
					success: false,
					error: { codigo, mensaje: "…" },
					data: { mensaje: "…", codigo },
				},
				identidad: null,
			});

			expect(interaccion).toBeNull();
		}
	});

	test("las exclusiones son la lista explícita, no un patrón", () => {
		expect(RUTAS_SIN_HISTORIAL.has("/api/bot/cobros/pagos/evento")).toBe(true);

		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/pagos/evento",
			cuerpo: { referencia: REFERENCIA },
			estado: 200,
			respuesta: { success: true, data: {} },
			identidad: null,
		});

		expect(interaccion).toBeNull();
	});
});

describe("buscar-cliente", () => {
	test("éxito: la referencia sale de la RESPUESTA y la búsqueda va enmascarada", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/buscar-cliente",
			cuerpo: { search: "1234567891234", telefono: "55551234" },
			estado: 200,
			respuesta: {
				success: true,
				data: {
					encontrado: true,
					celEnCrm: true,
					referencia: REFERENCIA,
					otpEnviadoA: "****1234",
					otpExpiraEnSegundos: 300,
					tipoBusqueda: "dpi",
					cliente: { nombreCompleto: "Juan Pérez" },
				},
			},
			identidad: IDENTIDAD,
		});

		expect(interaccion?.accion).toBe("buscar_cliente");
		expect(interaccion?.referencia).toBe(REFERENCIA);
		expect(interaccion?.detalle).toEqual({
			tipoBusqueda: "dpi",
			busqueda: "*********1234",
			celEnCrm: true,
			otpEnviadoA: "****1234",
		});
	});

	// El teléfono del chat NO tiene curador que lo copie: no puede llegar.
	test("el teléfono del chat y el nombre del cliente no se guardan", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/buscar-cliente",
			cuerpo: { search: "1234567891234", telefono: "55551234" },
			estado: 200,
			respuesta: {
				success: true,
				data: {
					referencia: REFERENCIA,
					tipoBusqueda: "dpi",
					cliente: { nombreCompleto: "Juan Pérez" },
				},
			},
			identidad: IDENTIDAD,
		});

		const serializado = JSON.stringify(interaccion?.detalle);
		expect(serializado).not.toContain("55551234");
		expect(serializado).not.toContain("Juan");
	});

	test("fallo con cliente conocido = acceso_fallido (D-43)", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/buscar-cliente",
			cuerpo: { search: "1234567891234" },
			estado: 429,
			respuesta: {
				success: false,
				error: { codigo: "DEMASIADOS_ENVIOS", mensaje: "Espera un momento" },
				data: {
					mensaje: "…",
					codigo: "DEMASIADOS_ENVIOS",
					reintentarEnSegundos: 42,
				},
			},
			identidad: IDENTIDAD,
		});

		expect(interaccion?.accion).toBe("acceso_fallido");
		expect(interaccion?.exito).toBe(false);
		expect(interaccion?.codigo).toBe("DEMASIADOS_ENVIOS");
		expect(interaccion?.detalle).toEqual({
			busqueda: "*********1234",
			reintentarEnSegundos: 42,
		});
	});

	test("fallo SIN cliente conocido no se registra: no hay ficha que lo muestre", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/buscar-cliente",
			cuerpo: { search: "9999999999999" },
			estado: 404,
			respuesta: {
				success: false,
				error: { codigo: "CLIENTE_NO_ENCONTRADO", mensaje: "…" },
				data: { encontrado: false },
			},
			identidad: null,
		});

		expect(interaccion).toBeNull();
	});
});

describe("listar-creditos (servicio 2)", () => {
	test("el código OTP del request JAMÁS llega al detalle", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/creditos",
			cuerpo: { referencia: REFERENCIA, otp: "4321" },
			estado: 200,
			respuesta: {
				success: true,
				data: { cantidadCreditos: 2, creditos: [{}, {}] },
			},
			identidad: null,
		});

		expect(JSON.stringify(interaccion)).not.toContain("4321");
		expect(interaccion?.detalle).toEqual({ creditos: 2 });
	});

	test("un código incorrecto queda con sus intentos restantes", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/creditos",
			cuerpo: { referencia: REFERENCIA, otp: "0000" },
			estado: 401,
			respuesta: {
				success: false,
				error: { codigo: "OTP_INVALIDO", mensaje: "…" },
				data: { mensaje: "…", codigo: "OTP_INVALIDO", intentosRestantes: 2 },
			},
			identidad: null,
		});

		expect(interaccion?.accion).toBe("listar_creditos");
		expect(interaccion?.exito).toBe(false);
		expect(interaccion?.codigo).toBe("OTP_INVALIDO");
		expect(interaccion?.detalle).toEqual({ intentosRestantes: 2 });
	});

	test("una referencia con basura no cuelga la fila de ninguna sesión", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/creditos",
			cuerpo: { referencia: "'; DROP TABLE otps;--", otp: "0000" },
			estado: 401,
			respuesta: {
				success: false,
				error: { codigo: "REFERENCIA_INVALIDA", mensaje: "…" },
				data: {},
			},
			identidad: null,
		});

		// Sin referencia válida ni identidad no hay a quién atribuirla.
		expect(interaccion).toBeNull();
	});
});

describe("boleta (paso 4)", () => {
	test("leer: guarda el resumen y NO la URL de la imagen", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/boleta/leer",
			cuerpo: {
				referencia: REFERENCIA,
				numeroSifco: "115900",
				imagenUrl: "https://cdn.simpletech.example/media/abc123.jpg",
			},
			estado: 200,
			respuesta: {
				success: true,
				data: {
					boletaId: "bbbbbbbb-0000-0000-0000-000000000001",
					intento: 1,
					intentosRestantes: 2,
					confianza: "alta",
					lectura: {
						banco: { id: 2, nombre: "Banrural", leido: "BANRURAL" },
						monto: "1500.00",
						fechaBoleta: "2026-08-22",
						numeroAutorizacion: "789456",
						cuentaDestino: "3394002346",
					},
				},
			},
			identidad: null,
		});

		expect(interaccion?.accion).toBe("boleta_leer");
		expect(interaccion?.numeroSifco).toBe("115900");
		expect(interaccion?.detalle).toEqual({
			boletaId: "bbbbbbbb-0000-0000-0000-000000000001",
			intento: 1,
			monto: "1500.00",
			banco: "Banrural",
			confianza: "alta",
		});
		expect(JSON.stringify(interaccion)).not.toContain("simpletech");
		// El número de autorización y la cuenta ya viven en bot_cobros_boletas.
		expect(JSON.stringify(interaccion?.detalle)).not.toContain("789456");
		expect(JSON.stringify(interaccion?.detalle)).not.toContain("3394002346");
	});

	test("confirmar: cuántos pagos creó cartera, con qué monto", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/boleta/confirmar",
			cuerpo: {
				referencia: REFERENCIA,
				numeroSifco: "115900",
				boletaId: "bbbbbbbb-0000-0000-0000-000000000001",
			},
			estado: 200,
			respuesta: {
				success: true,
				data: {
					pagoIds: [48213, 48214],
					cuotasCubiertas: [12, 13],
					estado: "en_validacion",
					monto: "1500.00",
					banco: "Banrural",
					fechaBoleta: "2026-08-22",
				},
			},
			identidad: null,
		});

		expect(interaccion?.accion).toBe("boleta_confirmar");
		expect(interaccion?.detalle).toEqual({
			boletaId: "bbbbbbbb-0000-0000-0000-000000000001",
			pagos: 2,
			cuotas: 2,
			monto: "1500.00",
			banco: "Banrural",
		});
	});

	test("un error de sesión también queda: la ficha muestra los tropiezos", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/boleta/confirmar",
			cuerpo: {
				referencia: REFERENCIA,
				numeroSifco: "115900",
				boletaId: "bbbbbbbb-0000-0000-0000-000000000001",
			},
			estado: 401,
			respuesta: {
				success: false,
				error: { codigo: "SESION_VENCIDA", mensaje: "…" },
				data: { mensaje: "…", codigo: "SESION_VENCIDA" },
			},
			identidad: null,
		});

		expect(interaccion?.exito).toBe(false);
		expect(interaccion?.codigo).toBe("SESION_VENCIDA");
		expect(interaccion?.detalle).toEqual({
			boletaId: "bbbbbbbb-0000-0000-0000-000000000001",
		});
	});
});

describe("consultas del menú", () => {
	test("el menú del crédito: acción + SIFCO, detalle vacío a propósito", () => {
		const interaccion = armarInteraccion({
			ruta: "/api/bot/cobros/credito/info",
			cuerpo: { referencia: REFERENCIA, numeroSifco: "115900" },
			estado: 200,
			respuesta: { success: true, data: { credito: { saldo: "45000.00" } } },
			identidad: null,
		});

		expect(interaccion?.accion).toBe("menu_credito");
		expect(interaccion?.numeroSifco).toBe("115900");
		// El saldo del crédito no es del historial: vive en cartera.
		expect(interaccion?.detalle).toEqual({});
	});
});
