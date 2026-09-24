import { describe, expect, test } from "bun:test";
import {
	ADVERTENCIAS_INOCUAS,
	exigeConstancia,
	exigeConstanciaPorFalla,
	MOTIVOS_SIN_EFECTO,
	STATUS_SIN_EFECTO,
	tieneCuentaSana,
} from "./salud-cuenta-portal";

/**
 * Las dos decisiones que el CRM toma sobre una respuesta de acceso al portal.
 *
 * Las dos son ASIMÉTRICAS y hacia el mismo lado: ante la duda, `tieneCuentaSana`
 * dice `false` (el botón sigue vivo) y `exigeConstancia` dice `true` (queda la
 * fila). En los dos casos el error barato es el que se elige, y el caro —un
 * botón gris sobre quien lo necesita, una contraseña mandada sin rastro— es el
 * que se hace imposible.
 */

const acceso = (over: Record<string, unknown> = {}) => ({
	estado: "ya_tenia",
	usuarioEmail: "ana@ejemplo.com",
	advertencias: [] as string[],
	motivo: null,
	...over,
});

describe("tieneCuentaSana", () => {
	test("una cuenta que ya existía y está limpia es sana", () => {
		expect(tieneCuentaSana(acceso())).toBe(true);
	});

	// LA PRUEBA QUE IMPORTA. Sin el rol INVESTOR la persona entra al portal y
	// no ve ninguna de sus inversiones: la cuenta existe y no sirve. Si esto
	// dijera `true`, el botón quedaría gris justo sobre la persona que necesita
	// que alguien lo apriete.
	test("ya tenía cuenta, pero sin el rol de inversionista NO es sana", () => {
		expect(
			tieneCuentaSana(
				acceso({ advertencias: ["cuenta_sin_rol_de_inversionista"] }),
			),
		).toBe(false);
	});

	test("ya tenía cuenta, pero con otro correo NO es sana", () => {
		// El portal resuelve qué inversionistas ve una sesión buscando su correo
		// en cartera. Con un correo que cartera no tiene, entra y ve una
		// pantalla vacía.
		expect(
			tieneCuentaSana(
				acceso({
					advertencias: ["correo_de_cartera_distinto_al_de_la_cuenta"],
				}),
			),
		).toBe(false);
	});

	test("las otras dos formas de quedarse sin rol tampoco son sanas", () => {
		for (const advertencia of [
			"rol_no_promovido",
			"cuenta_creada_sin_rol_ni_dpi",
		]) {
			expect(tieneCuentaSana(acceso({ advertencias: [advertencia] }))).toBe(
				false,
			);
		}
	});

	// EL CORAZÓN DE LA LISTA BLANCA. Una lista negra devolvía `true` ante
	// cualquier advertencia que no conociera, así que el día que auth-google
	// agregue una que signifique "la cuenta existe y no sirve" —o renombre una
	// de las de hoy— el botón se apagaría solo, sobre justo la persona que
	// necesita que alguien lo apriete, y con el síntoma borrado de la pantalla.
	test("una advertencia que nadie conoce NO es sana", () => {
		expect(
			tieneCuentaSana(
				acceso({ advertencias: ["advertencia_que_nadie_ha_escrito_todavia"] }),
			),
		).toBe(false);
	});

	test("cada advertencia inocua, por sí sola, deja la cuenta sana", () => {
		for (const advertencia of ADVERTENCIAS_INOCUAS) {
			expect(tieneCuentaSana(acceso({ advertencias: [advertencia] }))).toBe(
				true,
			);
		}
	});

	test("todas las inocuas juntas siguen dejándola sana", () => {
		expect(
			tieneCuentaSana(acceso({ advertencias: [...ADVERTENCIAS_INOCUAS] })),
		).toBe(true);
	});

	test("una desconocida entre inocuas basta para que NO sea sana", () => {
		expect(
			tieneCuentaSana(
				acceso({
					advertencias: [
						"cuenta_anclada_solo_por_correo",
						"advertencia_que_nadie_ha_escrito_todavia",
					],
				}),
			),
		).toBe(false);
	});

	// `cuenta_anclada_solo_por_correo` NO invalida: la cuenta funciona hoy
	// —tiene el rol y el correo que cartera reconoce—. Lo que avisa es un riesgo
	// FUTURO (si alguien le cambia el correo se crearía una segunda cuenta), y
	// el botón de dar acceso tampoco lo arregla: el módulo reporta ese vínculo
	// y a propósito NO escribe el DPI. Marcarla insana pondría un botón activo
	// que al apretarlo no hace nada.
	test("el vínculo frágil por correo no la vuelve insana", () => {
		expect(
			tieneCuentaSana(
				acceso({ advertencias: ["cuenta_anclada_solo_por_correo"] }),
			),
		).toBe(true);
	});

	test("cualquier estado que no sea 'ya_tenia' no es una cuenta sana", () => {
		for (const estado of [
			"candidata",
			"creada",
			"avisada",
			"omitida",
			"fallo",
		]) {
			expect(tieneCuentaSana(acceso({ estado, advertencias: [] }))).toBe(false);
		}
	});

	test("una empresa no tiene cuenta propia: nunca es sana", () => {
		expect(
			tieneCuentaSana(acceso({ estado: "omitida", motivo: "es_empresa" })),
		).toBe(false);
	});

	// LO QUE EL DOCBLOCK PROMETE: ante cualquier duda, `false`. Una respuesta
	// incompleta es duda, no permiso para apagar el botón.
	test("una respuesta incompleta o de otra forma NO es sana", () => {
		expect(tieneCuentaSana(null)).toBe(false);
		expect(tieneCuentaSana(undefined)).toBe(false);
		// Sin `advertencias` no sabemos si las hay: la forma cambió.
		expect(tieneCuentaSana({ estado: "ya_tenia" } as never)).toBe(false);
		expect(
			tieneCuentaSana({ estado: "ya_tenia", advertencias: null } as never),
		).toBe(false);
		// Ni siquiera es una lista de textos.
		expect(
			tieneCuentaSana({
				estado: "ya_tenia",
				advertencias: [{ codigo: "cuenta_sin_rol_de_inversionista" }],
			} as never),
		).toBe(false);
	});
});

const otorgado = (over: Record<string, unknown> = {}) => ({
	inversionistaId: 7,
	estado: "creada",
	usuarioEmail: "ana@ejemplo.com",
	correo: {
		enviado: true,
		plantilla: "bienvenida",
		redirigido: false,
		destinatarioReal: null,
	},
	advertencias: [] as string[],
	motivo: null,
	...over,
});

const sinCorreo = {
	enviado: false,
	plantilla: null,
	redirigido: false,
	destinatarioReal: null,
};

describe("exigeConstancia", () => {
	// LO QUE NO SE PUEDE PERDER: quién autorizó mandar una contraseña.
	test("una cuenta creada con su correo enviado SIEMPRE deja constancia", () => {
		expect(exigeConstancia(otorgado())).toBe(true);
	});

	test("un correo que salió deja constancia sea cual sea el estado", () => {
		for (const estado of ["creada", "ya_tenia", "avisada", "omitida", "fallo"]) {
			expect(
				exigeConstancia(
					otorgado({
						estado,
						motivo: "es_empresa_el_acceso_es_del_representante",
						correo: { ...sinCorreo, enviado: true },
					}),
				),
			).toBe(true);
		}
	});

	// EL CASO QUE DILUÍA LA BITÁCORA. Sobre una fila de empresa el camino de
	// lectura contesta `omitida/es_empresa` para siempre, así que el botón nunca
	// se apaga; cada apretón vuelve con este fallo, sin crear nada y sin mandar
	// ningún correo. Antes cada uno de esos apretones escribía una fila.
	test("la empresa, que se puede apretar para siempre, no deja fila", () => {
		expect(
			exigeConstancia(
				otorgado({
					estado: "fallo",
					usuarioEmail: null,
					correo: sinCorreo,
					motivo: "es_empresa_el_acceso_es_del_representante",
				}),
			),
		).toBe(false);
	});

	test("cada motivo que corta ANTES de salir a la red no deja fila", () => {
		for (const motivo of MOTIVOS_SIN_EFECTO) {
			expect(
				exigeConstancia(
					otorgado({
						estado: "fallo",
						usuarioEmail: null,
						correo: sinCorreo,
						motivo,
					}),
				),
			).toBe(false);
		}
	});

	// El timeout NO es un "no pasó nada": abortamos la espera, pero auth-google
	// pudo haber creado la cuenta y mandado la contraseña igual. Es el caso en
	// que más falta hace saber quién apretó.
	test("un timeout deja constancia: no sabemos si la contraseña salió", () => {
		expect(
			exigeConstancia(
				otorgado({
					estado: "fallo",
					usuarioEmail: null,
					correo: sinCorreo,
					motivo: "timeout",
				}),
			),
		).toBe(true);
	});

	test("un fallo con un motivo que no cortamos nosotros deja constancia", () => {
		for (const motivo of [
			"http_500",
			"cuenta_anclada_solo_por_correo",
			null,
			"lo_que_sea_que_conteste_auth_google",
		]) {
			expect(
				exigeConstancia(
					otorgado({
						estado: "fallo",
						usuarioEmail: null,
						correo: sinCorreo,
						motivo,
					}),
				),
			).toBe(true);
		}
	});

	test("una omisión sin correo ni advertencias no deja fila", () => {
		for (const motivo of ["sin_correo", "sin_nombre", "es_empresa"]) {
			expect(
				exigeConstancia(
					otorgado({
						estado: "omitida",
						usuarioEmail: null,
						correo: sinCorreo,
						motivo,
					}),
				),
			).toBe(false);
		}
	});

	// Una advertencia es trabajo pendiente para alguien: la fila es el único
	// lugar donde queda, porque el toast se lo lleva la siguiente pantalla.
	test("cualquier advertencia deja constancia, aunque nada se haya creado", () => {
		expect(
			exigeConstancia(
				otorgado({
					estado: "omitida",
					usuarioEmail: null,
					correo: sinCorreo,
					motivo: "sin_correo",
					advertencias: ["parece_sociedad_con_cuenta_propia"],
				}),
			),
		).toBe(true);
	});

	test("ya_tenia deja constancia: alguien autorizó tocar esa cuenta", () => {
		expect(
			exigeConstancia(
				otorgado({ estado: "ya_tenia", correo: sinCorreo, motivo: null }),
			),
		).toBe(true);
	});

	// No saber qué pasó nunca puede borrar el rastro: es justo cuando más hace
	// falta saber quién apretó.
	test("sin detalle, o con una forma que no reconocemos, deja constancia", () => {
		expect(exigeConstancia(null)).toBe(true);
		expect(exigeConstancia(undefined)).toBe(true);
		expect(exigeConstancia({} as never)).toBe(true);
		expect(exigeConstancia({ estado: "candidata" } as never)).toBe(true);
		expect(
			exigeConstancia({ estado: "un_estado_que_no_existe_todavia" } as never),
		).toBe(true);
	});

	// `omitida` sin `correo` en la respuesta: no se asume que no salió ninguno,
	// pero tampoco se convierte en duda un desenlace que cartera decide sin
	// salir a la red. Lo que manda es el estado.
	test("una omisión sin el bloque de correo sigue sin dejar fila", () => {
		expect(
			exigeConstancia({ estado: "omitida", motivo: "sin_correo" } as never),
		).toBe(false);
	});
});

/**
 * La otra mitad de "ante la duda siempre registra", y la que de verdad importa:
 * `exigeConstancia` solo se evalúa cuando HUBO respuesta. Cuando la llamada
 * falla no hay `detalle` que mirar, y el caso para el que se escribió la regla
 * —no sabemos si la contraseña salió— es precisamente ese.
 */
describe("exigeConstanciaPorFalla", () => {
	// LA PRUEBA QUE IMPORTA. El salto CRM→cartera aborta por timeout mientras
	// cartera sigue dentro de su `fetch` a auth-google: la contraseña puede
	// estar en el buzón y acá solo se ve "cartera no está respondiendo". Si esto
	// dijera `false`, no quedaría rastro de quién la mandó — y el reintento lo
	// entierra, porque la cuenta ya existe y el segundo apretón sale en verde.
	test("sin status (timeout, conexión cortada, breaker abierto) deja constancia", () => {
		expect(exigeConstanciaPorFalla(null)).toBe(true);
		expect(exigeConstanciaPorFalla(undefined)).toBe(true);
	});

	test("un 5xx deja constancia: cartera pudo haber entrado a provisionar", () => {
		for (const status of [500, 502, 503, 504]) {
			expect(exigeConstanciaPorFalla(status)).toBe(true);
		}
	});

	// Estos cuatro los contesta cartera ANTES de tocar nada: el 403 es la
	// primera línea de `otorgarAccesoPortal.ts`, el 401 ni llega al handler, el
	// 400 es la validación del cuerpo y el 404 es que la ruta no existe.
	test("los rechazos que preceden al trabajo no dejan fila", () => {
		for (const status of [400, 401, 403, 404]) {
			expect(exigeConstanciaPorFalla(status)).toBe(false);
		}
	});

	// Lista blanca, como las otras dos de este archivo: un status que todavía no
	// significa nada acá —o que ponga una pieza intermedia— NO puede callar la
	// constancia por omisión.
	test("un status que no está en la lista deja constancia", () => {
		for (const status of [402, 409, 418, 429, 451]) {
			expect(exigeConstanciaPorFalla(status)).toBe(true);
		}
	});

	test("la lista blanca es la de los rechazos previos al trabajo", () => {
		expect([...STATUS_SIN_EFECTO].sort()).toEqual([400, 401, 403, 404]);
	});
});
