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
import { creditoAceptaBoleta, estimarAplicacion, hoyGuatemala } from "./boleta";
import {
	destinoResuelto,
	esDireccionPrivada,
	urlPermitida,
} from "./descarga-imagen";
import {
	type BoletaLeida,
	calcularConfianza,
	esFechaDeCalendario,
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

	// Una IPv4 se puede escribir como IPv6 y sigue siendo la misma máquina. Si
	// un dominio de la allowlist tuviera un AAAA así, el filtro lo dejaba pasar
	// y el SSRF quedaba abierto de nuevo.
	test("una IPv4 privada disfrazada de IPv6 tampoco pasa", () => {
		expect(esDireccionPrivada("::ffff:127.0.0.1")).toBe(true);
		expect(esDireccionPrivada("::ffff:10.0.0.5")).toBe(true);
		// Los metadatos del cloud, en la forma hexadecimal (169.254.169.254).
		expect(esDireccionPrivada("::ffff:a9fe:a9fe")).toBe(true);
		// Y en corchetes, como viene de una URL.
		expect(esDireccionPrivada("[::ffff:169.254.169.254]")).toBe(true);
		// Una pública disfrazada sigue siendo pública: el filtro no bloquea todo.
		expect(esDireccionPrivada("::ffff:8.8.8.8")).toBe(false);
	});

	test("los rangos IPv6 propios siguen bloqueados", () => {
		expect(esDireccionPrivada("fd00::1")).toBe(true);
		expect(esDireccionPrivada("fe80::1")).toBe(true);
		expect(esDireccionPrivada("::")).toBe(true);
		expect(esDireccionPrivada("2001:4860:4860::8888")).toBe(false);
	});

	// `/^f[cd]/` daba por privado cualquier host que empezara con esas letras.
	// Fallaba cerrado, pero un CDN llamado así no se podía usar nunca.
	test("un dominio no es privado por empezar como un rango IPv6", () => {
		expect(esDireccionPrivada("fdn-cdn.com")).toBe(false);
		expect(esDireccionPrivada("fc-imagenes.net")).toBe(false);
	});

	// No basta con mirar el texto del host: la allowlist puede estar conforme y
	// el nombre apuntar adentro. Estos dos casos no salen a la red de verdad
	// —`localhost` sale de /etc/hosts y `.invalid` no resuelve nunca—, así que
	// la prueba no depende de tener internet.
	test("un nombre que resuelve a una IP privada no se descarga", async () => {
		expect(await destinoResuelto("localhost")).toBe("privada");
	});

	test("un nombre que no resuelve no es un problema de permisos", async () => {
		expect(await destinoResuelto("no-existe-de-verdad.invalid")).toBe(
			"desconocida",
		);
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

	// El caso que importa: "1,50" son Q1.50. Borrando la coma se volvían Q150 y
	// el cliente confirmaba —y pagaba— cien veces su boleta.
	test("una coma decimal no multiplica el monto por cien", () => {
		expect(montoALimpio("1,50")).toBe(1.5);
		expect(montoALimpio("Q1,50")).toBe(1.5);
		expect(montoALimpio("1.500,00")).toBe(1500);
		expect(montoALimpio("15.250,75")).toBe(15250.75);
	});

	test("la coma de miles sigue siendo de miles", () => {
		expect(montoALimpio("1,500")).toBe(1500);
		expect(montoALimpio("1,500.00")).toBe(1500);
		expect(montoALimpio("12,345,678.90")).toBe(12345678.9);
		expect(montoALimpio("1.500.000")).toBe(1500000);
	});

	// Un "1.500" puede ser Q1.50 o Q1,500 y no hay forma de saberlo. Se prefiere
	// pedir otra foto —cuesta un intento— a registrar el monto equivocado.
	test("lo ambiguo se rechaza en vez de adivinarse", () => {
		expect(montoALimpio("1.500")).toBeNull();
		expect(montoALimpio("1,5000")).toBeNull();
		expect(montoALimpio("1.500,000")).toBeNull();
		expect(montoALimpio("12,34,56")).toBeNull();
	});

	// Un negativo en un comprobante no es un pago: es una nota de débito, una
	// reversa o basura de la lectura. Borrarle el signo lo convertía en un pago
	// de Q500 que el cliente confirmaba.
	test("un monto con signo se rechaza en vez de volverse positivo", () => {
		expect(montoALimpio("-Q500.00")).toBeNull();
		expect(montoALimpio("Q-500.00")).toBeNull();
		expect(montoALimpio("500.00-")).toBeNull();
		expect(montoALimpio("−1,500.00")).toBeNull();
		expect(montoALimpio("+500.00")).toBeNull();
	});

	test("un separador colgando al final no arruina la lectura", () => {
		expect(montoALimpio("1500.")).toBe(1500);
		expect(montoALimpio("Q 2,340.00 ")).toBe(2340);
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
		moraPorConfirmar: false,
		paraCuota: "3000.00",
		cubreMora: true,
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
		// El faltante se calcula DESPUÉS de aplicar el pago: Q5,891.15 − Q3,000.
		expect(armarMensajesBoleta(base).completo).toContain(
			"Después de este pago te faltarán: Q2,891.15",
		);
	});

	test("nunca muestra el saldo de la cuota como si el pago no existiera", () => {
		// Decirle "te faltan Q5,891.15" a alguien que acaba de abonar Q3,000 se
		// lee como que su pago no sirvió de nada.
		expect(armarMensajesBoleta(base).completo).not.toContain("Q5,891.15");
	});

	test("con mora por confirmar no promete nada de la cuota", () => {
		// Hay mora pero cartera no puede citar el monto: cualquier cuenta que
		// hagamos sobre la cuota sería inventada.
		const m = armarMensajesBoleta({
			...base,
			mora: null,
			moraPorConfirmar: true,
			paraCuota: null,
			cubreMora: false,
		});

		expect(m.completo).toContain("Tu asesor te confirma el monto exacto");
		expect(m.completo).not.toContain("Cubre la cuota completa");
		expect(m.completo).not.toContain("te faltarán");
	});

	test("con mora por confirmar NO se contradice sobre el orden", () => {
		// `mora` viene en null aunque haya mora: si el orden se decidiera solo
		// por ese campo, el mensaje diría "a tu cuota 8 de 84" y dos líneas más
		// abajo "primero se cubre tu mora".
		const m = armarMensajesBoleta({
			...base,
			mora: null,
			moraPorConfirmar: true,
			paraCuota: null,
			cubreMora: false,
		});

		expect(m.completo).toContain("1. A tu mora pendiente");
		expect(m.completo).toContain("2. A tu cuota 8 de 84");
		// La forma que usa cuando NO hay mora: tres espacios y la cuota directo.
		expect(m.completo).not.toContain("\n   A tu cuota 8 de 84");
	});

	test("sin mora, la cuota va sin numerar", () => {
		const m = armarMensajesBoleta({
			...base,
			mora: null,
			moraPorConfirmar: false,
			paraCuota: "500.00",
		});

		expect(m.completo).toContain("   A tu cuota 8 de 84");
		expect(m.completo).not.toContain("1. A tu mora");
	});

	test("si no alcanza ni para la mora, no habla de la cuota", () => {
		// Decir "te faltan Q2,891.15 de tu cuota" cuando a la cuota no le llega
		// nada es una promesa falsa disfrazada de dato.
		const m = armarMensajesBoleta({
			...base,
			cubreMora: false,
			paraCuota: "0.00",
		});

		expect(m.completo).toContain("Este pago se aplica todo a tu mora");
		expect(m.completo).not.toContain("te faltarán");
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

describe("a dónde va el dinero de la boleta", () => {
	test("la mora se descuenta ANTES de mirar la cuota", () => {
		// Q6,000 con Q1,000 de mora y una cuota de Q5,500: a la cuota le llegan
		// Q5,000, así que NO la cubre. Sin restar la mora, el mensaje le
		// prometería al cliente algo que no va a pasar.
		const r = estimarAplicacion({
			monto: 6000,
			mora: "1000",
			moraPorConfirmar: false,
			saldoCuota: "5500",
			numeroCuota: 8,
		});

		expect(r.cubreMora).toBe(true);
		expect(r.paraCuota).toBe("5000.00");
		expect(r.cubreCuota).toBe(false);
		expect(r.orden).toEqual(["mora", "cuota_8"]);
	});

	test("sin mora, todo el monto va a la cuota", () => {
		const r = estimarAplicacion({
			monto: 6000,
			mora: null,
			moraPorConfirmar: false,
			saldoCuota: "5500",
			numeroCuota: 8,
		});

		expect(r.cubreMora).toBe(true);
		expect(r.paraCuota).toBe("6000.00");
		expect(r.cubreCuota).toBe(true);
		expect(r.excedente).toBe("500.00");
		expect(r.orden).toEqual(["cuota_8"]);
	});

	test("si no alcanza ni para la mora, a la cuota no le llega nada", () => {
		const r = estimarAplicacion({
			monto: 500,
			mora: "1178.23",
			moraPorConfirmar: false,
			saldoCuota: "5891.15",
			numeroCuota: 8,
		});

		expect(r.cubreMora).toBe(false);
		expect(r.paraCuota).toBe("0.00");
		expect(r.cubreCuota).toBe(false);
	});

	test("sin saldo de cuota no se afirma que la cubre", () => {
		const r = estimarAplicacion({
			monto: 9999,
			mora: null,
			moraPorConfirmar: false,
			saldoCuota: null,
			numeroCuota: 8,
		});

		expect(r.cubreCuota).toBe(false);
		expect(r.excedente).toBe("0.00");
	});

	test("con mora por confirmar NO se estima: null no es cero", () => {
		// Cartera devuelve mora: null cuando la foto de la mora quedó vieja. Si
		// eso se leyera como "no tiene mora", el bot anunciaría que todo el
		// dinero va a la cuota mientras cartera descuenta un monto desconocido.
		const r = estimarAplicacion({
			monto: 6000,
			mora: null,
			moraPorConfirmar: true,
			saldoCuota: "5500",
			numeroCuota: 8,
		});

		expect(r.moraPorConfirmar).toBe(true);
		expect(r.paraCuota).toBeNull();
		expect(r.cubreCuota).toBe(false);
		expect(r.orden).toEqual(["mora", "cuota_8"]);
	});

	test("va siempre marcada como estimación", () => {
		expect(
			estimarAplicacion({
				monto: 100,
				mora: null,
				moraPorConfirmar: false,
				saldoCuota: null,
				numeroCuota: 1,
			}).estimado,
		).toBe(true);
	});
});

describe("fechas que existen en el calendario", () => {
	test("un 31 de febrero no pasa", () => {
		// El modelo devuelve esto de vez en cuando. Con solo mirar la forma,
		// llegaría hasta el INSERT y Postgres lo convertiría en un 500 — con la
		// imagen ya subida y sin borrador que la referencie.
		expect(esFechaDeCalendario("2026-02-31")).toBe(false);
		expect(fechaBoletaValida("2026-02-31", "2026-08-20").corregida).toBe(true);
	});

	test("un mes 13 tampoco", () => {
		expect(esFechaDeCalendario("2026-13-01")).toBe(false);
	});

	test("una fecha real sí", () => {
		expect(esFechaDeCalendario("2026-02-28")).toBe(true);
		expect(esFechaDeCalendario("2024-02-29")).toBe(true); // bisiesto
	});
});

describe("a qué créditos se les acepta una boleta", () => {
	test("los tres estados que cartera admite y el negocio quiere", () => {
		expect(creditoAceptaBoleta("ACTIVO")).toBe(true);
		expect(creditoAceptaBoleta("MOROSO")).toBe(true);
		expect(creditoAceptaBoleta("EN_CONVENIO")).toBe(true);
	});

	test("CAIDO no pasa: cartera lo rechaza con 404", () => {
		// Con una lista negra, este estado pasaba nuestro filtro, el cliente
		// subía su boleta y confirmaba, y recién ahí cartera la rechazaba.
		expect(creditoAceptaBoleta("CAIDO")).toBe(false);
	});

	test("INCOBRABLE tampoco, aunque cartera sí lo acepte", () => {
		// Decisión del contrato (§13): esos casos van con un asesor.
		expect(creditoAceptaBoleta("INCOBRABLE")).toBe(false);
	});

	test("un estado que no conocemos falla cerrado", () => {
		// Lo importante de la lista blanca: lo que se invente mañana no avanza.
		expect(creditoAceptaBoleta("ESTADO_NUEVO_DE_2027")).toBe(false);
		expect(creditoAceptaBoleta("")).toBe(false);
	});
});
