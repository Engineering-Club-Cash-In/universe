/**
 * Las reglas del paso 4 que se pueden probar sin red ni base.
 *
 * Lo que se prueba acá decide cuánta plata se registra y en qué banco la busca
 * contabilidad, así que va con casos tomados de boletas reales.
 */

import { describe, expect, test } from "bun:test";
import {
	bancoValido,
	normalizarNombreBanco,
	reconocerBanco,
} from "./bancos-boleta";
import { hoyGuatemala } from "./boleta";
import { esDireccionPrivada, urlPermitida } from "./descarga-imagen";
import {
	type BoletaLeida,
	calcularConfianza,
	fechaBoletaValida,
	montoALimpio,
} from "./lectura-boleta";
import { armarMensajesBoleta } from "./mensajes-boleta";

describe("reconocer el banco de la boleta", () => {
	test("los DOS nombres de Banrural caen en el mismo id", () => {
		// La misma hoja trae "BANRURAL" en el logo y "Banco de Desarrollo Rural,
		// S.A." en el pie. Son las dos filas duplicadas del catálogo.
		expect(reconocerBanco("BANRURAL")?.id).toBe(2);
		expect(reconocerBanco("Banco de Desarrollo Rural, S.A.")?.id).toBe(2);
	});

	test("G&T cae en el id universal (19), no en el 3", () => {
		// El 3 es el que más usa conta, pero el id universal lo tiene el 19.
		expect(reconocerBanco("BANCO G&T CONTINENTAL")?.id).toBe(19);
		expect(reconocerBanco("GyT Continental")?.id).toBe(19);
	});

	test("BAM cae en el 16, que es el que se usa", () => {
		expect(reconocerBanco("Banco Agromercantil")?.id).toBe(16);
		expect(reconocerBanco("BAM")?.id).toBe(16);
	});

	test("aguanta tildes, puntuación y S.A.", () => {
		expect(normalizarNombreBanco("Banco de Desarrollo Rural, S.A.")).toBe(
			"banco de desarrollo rural",
		);
		expect(reconocerBanco("banco industrial s.a.")?.id).toBe(1);
	});

	test("los alias cortos no se enganchan dentro de otra palabra", () => {
		// "bi" está dentro de "combi"; si el match fuera por substring, un
		// comprobante de "COMBI EXPRESS" caería en Banco Industrial.
		expect(reconocerBanco("combi express")).toBeNull();
		expect(reconocerBanco("BI")?.id).toBe(1);
	});

	test("banco desconocido devuelve null, no el más parecido", () => {
		// Adivinar el banco es adivinar en qué cuenta busca conta el dinero.
		expect(reconocerBanco("Banco Falso del Sur")).toBeNull();
		expect(reconocerBanco("")).toBeNull();
		expect(reconocerBanco(null)).toBeNull();
	});

	test("los bancos de prueba del catálogo NO son válidos", () => {
		expect(reconocerBanco("test")).toBeNull();
		expect(bancoValido(14)).toBe(false);
		expect(bancoValido(15)).toBe(false);
	});

	test("Interbanco y PAGALO se reconocen aunque no tengan id universal", () => {
		expect(reconocerBanco("Interbanco")?.id).toBe(27);
		expect(bancoValido(28)).toBe(true);
	});
});

describe("de dónde se acepta descargar (SSRF)", () => {
	const conAllowlist = (dominios: string, fn: () => void) => {
		const previo = process.env.BOT_COBROS_DOMINIOS_IMAGEN;
		process.env.BOT_COBROS_DOMINIOS_IMAGEN = dominios;
		try {
			fn();
		} finally {
			if (previo === undefined) delete process.env.BOT_COBROS_DOMINIOS_IMAGEN;
			else process.env.BOT_COBROS_DOMINIOS_IMAGEN = previo;
		}
	};

	test("sin allowlist configurada no se descarga NADA", () => {
		// Falla cerrada: desplegar sin la env deja al bot sin leer boletas, que
		// es molesto pero infinitamente mejor que descargar cualquier URL.
		conAllowlist("", () => {
			expect(urlPermitida("https://cdn.simpletech.gt/a.jpg")).toBe(false);
		});
	});

	test("solo https y solo dominios de la lista", () => {
		conAllowlist("simpletech.gt,lookaside.fbsbx.com", () => {
			expect(urlPermitida("https://cdn.simpletech.gt/a.jpg")).toBe(true);
			expect(urlPermitida("https://lookaside.fbsbx.com/x")).toBe(true);
			expect(urlPermitida("http://cdn.simpletech.gt/a.jpg")).toBe(false);
			expect(urlPermitida("https://otrositio.com/a.jpg")).toBe(false);
		});
	});

	test("un dominio que solo TERMINA parecido no pasa", () => {
		conAllowlist("simpletech.gt", () => {
			expect(urlPermitida("https://malsimpletech.gt/a.jpg")).toBe(false);
			expect(urlPermitida("https://simpletech.gt.malo.com/a.jpg")).toBe(false);
		});
	});

	test("las direcciones internas se bloquean aunque estén en la lista", () => {
		expect(esDireccionPrivada("127.0.0.1")).toBe(true);
		expect(esDireccionPrivada("10.0.0.5")).toBe(true);
		expect(esDireccionPrivada("172.16.0.1")).toBe(true);
		expect(esDireccionPrivada("192.168.1.1")).toBe(true);
		// Los metadatos del cloud: el destino clásico de un SSRF.
		expect(esDireccionPrivada("169.254.169.254")).toBe(true);
		expect(esDireccionPrivada("localhost")).toBe(true);
		expect(esDireccionPrivada("::1")).toBe(true);
		expect(esDireccionPrivada("8.8.8.8")).toBe(false);
	});
});

describe("limpiar lo que devuelve el modelo", () => {
	test("el monto aguanta que venga con Q y comas", () => {
		expect(montoALimpio("500.00")).toBe(500);
		expect(montoALimpio("Q1,500.50")).toBe(1500.5);
		expect(montoALimpio("6,264.10")).toBe(6264.1);
	});

	test("un monto inservible es null, no cero", () => {
		expect(montoALimpio(undefined)).toBeNull();
		expect(montoALimpio("")).toBeNull();
		expect(montoALimpio("0")).toBeNull();
		expect(montoALimpio("no se lee")).toBeNull();
	});

	test("una boleta del futuro se corrige a hoy", () => {
		const r = fechaBoletaValida("2030-01-01", "2026-08-20");
		expect(r).toEqual({ fecha: "2026-08-20", corregida: true });
	});

	test("una fecha vieja se respeta: hay boletas de hace meses", () => {
		const r = fechaBoletaValida("2026-04-27", "2026-08-20");
		expect(r).toEqual({ fecha: "2026-04-27", corregida: false });
	});

	test("sin fecha o con basura se usa hoy y se avisa", () => {
		expect(fechaBoletaValida(undefined, "2026-08-20").corregida).toBe(true);
		expect(fechaBoletaValida("27/04/2026", "2026-08-20").corregida).toBe(true);
	});

	test("hoyGuatemala no se corre un día por UTC", () => {
		// 2026-08-21 00:30 UTC son todavía las 18:30 del 20 en Guatemala.
		expect(hoyGuatemala(new Date("2026-08-21T00:30:00Z"))).toBe("2026-08-20");
		expect(hoyGuatemala(new Date("2026-08-20T18:00:00Z"))).toBe("2026-08-20");
	});
});

describe("confianza de la lectura", () => {
	const lectura = (extra: Partial<BoletaLeida> = {}): BoletaLeida => ({
		banco: "BANRURAL",
		monto: "500.00",
		fechaBoleta: "2026-04-27",
		numeroAutorizacion: "524075550",
		cuentaDestino: "3394002346",
		esBoletaDePago: true,
		extraccionExitosa: true,
		camposNoLeidos: [],
		...extra,
	});

	test("todo leído y banco reconocido = alta", () => {
		expect(calcularConfianza(lectura(), true)).toBe("alta");
	});

	test("sin banco reconocido = baja, aunque el resto esté", () => {
		expect(calcularConfianza(lectura(), false)).toBe("baja");
	});

	test("sin fecha = baja", () => {
		expect(calcularConfianza(lectura({ fechaBoleta: undefined }), true)).toBe(
			"baja",
		);
	});

	test("falta solo la autorización = media", () => {
		expect(
			calcularConfianza(lectura({ numeroAutorizacion: undefined }), true),
		).toBe("media");
	});
});

describe("el mensaje que confirma el cliente", () => {
	const base = {
		monto: "500.00",
		banco: "Banrural",
		fechaBoleta: "2026-04-27",
		numeroAutorizacion: "524075550",
		cuotaNumero: 8,
		cuotaDe: 84,
		saldoCuota: "5891.15",
		mora: "1178.23",
		cubreCuota: false,
		camposFaltantes: [] as string[],
	};

	test("usa la negrita de WhatsApp, que es UN asterisco", () => {
		const m = armarMensajesBoleta(base);
		expect(m.completo).not.toContain("**");
	});

	test("el monto y la fecha se leen como los lee una persona", () => {
		const m = armarMensajesBoleta(base);
		expect(m.titulo).toContain("Q500.00");
		expect(m.completo).toContain("27 de abril de 2026");
	});

	test("dice que la mora va primero, porque cartera aplica así", () => {
		const m = armarMensajesBoleta(base);
		expect(m.completo).toContain("1. A tu mora de Q1,178.23");
		expect(m.completo).toContain("2. A tu cuota 8 de 84");
	});

	test("sin mora no se inventa un paso 1", () => {
		const m = armarMensajesBoleta({ ...base, mora: null });
		expect(m.completo).not.toContain("mora");
		expect(m.completo).toContain("A tu cuota 8 de 84");
	});

	test("si cubre la cuota lo dice, y si no dice cuánto falta", () => {
		expect(
			armarMensajesBoleta({ ...base, cubreCuota: true }).completo,
		).toContain("Cubre la cuota completa");
		expect(armarMensajesBoleta(base).completo).toContain(
			"Falta de esa cuota: Q5,891.15",
		);
	});

	test("avisa sin tecnicismos cuando faltó leer algo", () => {
		const m = armarMensajesBoleta({
			...base,
			camposFaltantes: ["numeroAutorizacion"],
		});
		expect(m.completo).toContain("No pudimos leer todo");
		// Al cliente no le sirve el nombre del campo.
		expect(m.completo).not.toContain("numeroAutorizacion");
	});

	test("siempre termina preguntando", () => {
		const m = armarMensajesBoleta(base);
		expect(m.resumen.endsWith("¿Está correcto?")).toBe(true);
		expect(m.completo.endsWith("¿Está correcto?")).toBe(true);
	});
});
