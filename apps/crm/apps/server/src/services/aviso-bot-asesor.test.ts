import { beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * COBROS-02 Fase 1.b. Lo que cuidan estas pruebas es que el aviso NO se dispare
 * cuando no debe: es código que corre en cada petición del bot, así que un
 * arranque de más significa un HTTP a cartera por cada pantalla que el cliente
 * abre, y una fila de más significa spamear al asesor por conversación.
 */

// ── Fakes ───────────────────────────────────────────────────────────────────
const llamadasCartera: { numeroSifco: string; useCache: unknown }[] = [];
let asesorEmail: string | null = "asesor@clubcashin.com";

mock.module("./cartera-back-client", () => ({
	carteraBackClient: {
		getCredito: async (numeroSifco: string, useCache?: boolean) => {
			llamadasCartera.push({ numeroSifco, useCache });
			return {
				asesor: { emailCashIn: asesorEmail },
				usuario: { nombre: "Cliente de Prueba" },
			};
		},
	},
}));

mock.module("./cartera-back-integration", () => ({
	isCarteraBackEnabled: () => true,
}));

/** Filas insertadas por la función bajo prueba. */
const insertadas: Record<string, unknown>[] = [];
/** Qué devuelve el SELECT de dedup (vacío = no avisado todavía). */
let yaAvisado: { id: string }[] = [];
/** Qué devuelve el SELECT de caso de cobros. */
let casoEncontrado: { id: string; responsableCobros: string | null }[] = [
	{ id: "caso-1", responsableCobros: "user-1" },
];
/** Qué devuelve el SELECT de usuario del CRM por correo. */
let usuarioEncontrado: { id: string; name: string; role?: string }[] = [
	{ id: "user-1", name: "Asesor" },
];
/** Orden en el que se pidieron los SELECT, para saber cuál responder. */
let selectsHechos = 0;

mock.module("../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => {
					// El lookup del caso ordena antes de limitar (activo primero,
					// luego el más reciente); los otros dos van directo a limit.
					const responder = async () => {
						selectsHechos += 1;
						if (selectsHechos === 1) return yaAvisado;
						if (selectsHechos === 2) return casoEncontrado;
						return usuarioEncontrado;
					};
					return {
						limit: responder,
						orderBy: () => ({ limit: responder }),
					};
				},
			}),
		}),
		insert: () => ({
			values: (fila: Record<string, unknown>) => ({
				onConflictDoNothing: async () => {
					insertadas.push(fila);
				},
			}),
		}),
	},
}));

const {
	avisarAsesorPorInteraccionBot,
	llaveDedupSesionBot,
	pruebaPropiedadDelCredito,
} = await import("./aviso-bot-asesor");

const SESION = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";

beforeEach(() => {
	llamadasCartera.length = 0;
	insertadas.length = 0;
	selectsHechos = 0;
	yaAvisado = [];
	casoEncontrado = [{ id: "caso-1", responsableCobros: "user-1" }];
	usuarioEncontrado = [{ id: "user-1", name: "Asesor" }];
	asesorEmail = "asesor@clubcashin.com";
});

describe("la llave de dedup", () => {
	it("es la referencia de conversación, no el mensaje ni el día", () => {
		expect(llaveDedupSesionBot(SESION, "0101")).toBe(
			`bot:sesion:${SESION}:credito:0101`,
		);
	});

	// El índice único lleva `assigned_to`, así que una llave de solo sesión no
	// garantizaba nada entre asesores distintos: dos peticiones simultáneas de
	// la misma conversación sobre créditos de dos dueños insertaban las dos
	// (review de Codex, P2). Con el crédito adentro, la unicidad que sostiene la
	// base es la que el código promete.
	it("distingue créditos: cada dueño recibe lo suyo", () => {
		expect(llaveDedupSesionBot(SESION, "0101")).not.toBe(
			llaveDedupSesionBot(SESION, "0202"),
		);
	});
});

describe("cuándo NO se avisa", () => {
	it("sin sesión (un acceso_fallido) no hay a qué colgarse", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: null,
			numeroSifco: "0101",
			accion: "buscar_cliente",
		exito: true,
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});

	it("sin numero_sifco todavía no se sabe de qué crédito se trata", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: null,
			accion: "listar_creditos",
		exito: true,
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});

	it("si esta conversación ya avisó, ni siquiera se consulta cartera", async () => {
		yaAvisado = [{ id: "notif-1" }];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		exito: true,
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});

	it("un asesor sin usuario del CRM enlazado por correo no recibe nada", async () => {
		usuarioEncontrado = [];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		exito: true,
		});
		expect(insertadas).toHaveLength(0);
	});

	it("un fallo de ACCESO no avisa ni quema la llave", async () => {
		// El numeroSifco sale del body: una sesión válida con el crédito de otro
		// cliente llega hasta acá y el endpoint la rechaza. Sin este filtro se
		// avisaba al asesor ajeno y se consumía la dedup de la conversación.
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
			exito: false,
			codigo: "CREDITO_NO_ES_DEL_CLIENTE",
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});

	it("un fallo SIN código se trata como si no hubiera pasado el control", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
			exito: false,
			codigo: null,
		});
		expect(insertadas).toHaveLength(0);
	});

	it("un crédito sin asesor en cartera tampoco", async () => {
		asesorEmail = null;
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		exito: true,
		});
		expect(insertadas).toHaveLength(0);
	});
});

/**
 * La regla que decide si la interacción probó que el crédito es del cliente.
 * Exigir que TODA la operación saliera bien era demasiado: los fallos
 * posteriores al control de acceso son sobre el crédito legítimo, y son justo
 * cuando el cliente más necesita que lo llamen (review de Codex, P2).
 */
describe("pruebaPropiedadDelCredito", () => {
	it("una petición exitosa, obviamente", () => {
		expect(pruebaPropiedadDelCredito({ exito: true })).toBe(true);
	});

	it("un fallo POSTERIOR al control sí cuenta: el bot no pudo ayudarlo", () => {
		expect(
			pruebaPropiedadDelCredito({
				exito: false,
				codigo: "CARTERA_NO_DISPONIBLE",
			}),
		).toBe(true);
	});

	it("un fallo de acceso no", () => {
		for (const codigo of [
			// El PÚBLICO: los controladores traducen CREDITO_NO_ES_DEL_CLIENTE a
			// este antes de que el historial lo lea, para que nadie averigüe qué
			// créditos existen probando números. Es el que se escapaba con la
			// lista negra (review de Codex).
			"CREDITO_NO_ENCONTRADO",
			"CREDITO_NO_ES_DEL_CLIENTE",
			"OTP_VENCIDO",
			"SESION_VENCIDA",
			"NO_AUTORIZADO",
		]) {
			expect(pruebaPropiedadDelCredito({ exito: false, codigo })).toBe(false);
		}
	});

	it("un código DESCONOCIDO calla: lo desconocido no prueba propiedad", () => {
		// La asimetría que justifica la lista blanca: avisar de más manda el
		// aviso al asesor de un crédito ajeno; avisar de menos cuesta un
		// seguimiento.
		expect(
			pruebaPropiedadDelCredito({ exito: false, codigo: "CODIGO_NUEVO_2027" }),
		).toBe(false);
	});

	it("un fallo sin código tampoco (lado seguro)", () => {
		expect(pruebaPropiedadDelCredito({ exito: false })).toBe(false);
		expect(pruebaPropiedadDelCredito({ exito: false, codigo: null })).toBe(
			false,
		);
	});
});

describe("cuando sí se avisa", () => {
	it("un fallo posterior al control avisa, y el texto lo dice", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "estado_cuenta",
			exito: false,
			codigo: "CARTERA_NO_DISPONIBLE",
		});
		expect(insertadas).toHaveLength(1);
		expect(String(insertadas[0].descripcion)).toContain(
			"El bot no pudo completarlo",
		);
	});

	it("un crédito SIN caso de cobros igual avisa, pero sin enlace", async () => {
		// sync-casos-cobros solo mantiene caso activo con diasMora > 0, así que
		// exigirlo dejaba sin aviso justo a los buckets sanos — los que la
		// decisión 16 nombra explícitamente (review de Codex, P1).
		casoEncontrado = [];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "01010214119660",
			accion: "menu_credito",
			exito: true,
		});
		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].relatedEntityId).toBeUndefined();
		expect(insertadas[0].redirectPage).toBeUndefined();
		expect(insertadas[0].assignedTo).toBe("user-1");
		expect(String(insertadas[0].descripcion)).toContain("01010214119660");
	});

	it("le escribe al asesor dueño, con la llave de la conversación", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "01010214119660",
			accion: "estado_cuenta",
		exito: true,
		});
		expect(insertadas).toHaveLength(1);
		const fila = insertadas[0];
		expect(fila.cobrosTipo).toBe("bot_cliente_escribio");
		expect(fila.cobrosDedupKey).toBe(
			`bot:sesion:${SESION}:credito:01010214119660`,
		);
		expect(fila.assignedTo).toBe("user-1");
		expect(fila.relatedEntityId).toBe("caso-1");
		// El texto dice QUÉ vino a hacer: es lo que le dice al asesor si puede
		// esperar o no.
		expect(String(fila.descripcion)).toContain("pidió su estado de cuenta");
		expect(String(fila.descripcion)).toContain("01010214119660");
	});

	it("el dueño se lee SIN cache: el motor pudo reasignarlo anoche", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		exito: true,
		});
		expect(llamadasCartera).toHaveLength(1);
		expect(llamadasCartera[0].useCache).toBe(false);
	});

	it("una acción desconocida igual avisa, con texto genérico", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "una_accion_nueva_del_bot",
		exito: true,
		});
		expect(insertadas).toHaveLength(1);
		expect(String(insertadas[0].descripcion)).toContain(
			"escribió al bot de cobros",
		);
	});
});

/**
 * La allowlist de `pruebaPropiedadDelCredito` no se sostiene sola: cada código
 * vale como prueba SOLO si su camino verifica la propiedad antes de devolverlo.
 *
 * `MONTO_DESACTUALIZADO` fue el contraejemplo real (review de Codex, P2):
 * `crearPagoLink` parseaba el monto antes de `armarContexto`, así que un monto
 * inválido contra el SIFCO de otro cliente devolvía un código "posterior al
 * control" sin haber pasado por control alguno — y el asesor de ese crédito
 * ajeno recibía el aviso.
 *
 * Se afirma sobre el ORDEN EN LA FUENTE porque es exactamente lo que un
 * refactor puede invertir sin que ninguna prueba de comportamiento lo note.
 */
describe("orden de validación en crearPagoLink", () => {
	it("verifica la propiedad del crédito antes de rechazar por monto", async () => {
		const fuente = await Bun.file(
			new URL("../lib/bot-cobros/pago-link.ts", import.meta.url).pathname,
		).text();
		const cuerpo = fuente.slice(
			fuente.indexOf("export async function crearPagoLink("),
		);
		const posPropiedad = cuerpo.indexOf("await armarContexto(");
		const posMonto = cuerpo.indexOf("normalizarMonto(montoCrudo)");

		expect(posPropiedad).toBeGreaterThan(-1);
		expect(posMonto).toBeGreaterThan(-1);
		expect(posPropiedad).toBeLessThan(posMonto);
	});
});

// El modo agente trae su propia alerta, creada por el endpoint ANTES de que el
// historial corra: un "escribió" acá llegaría después y taparía la importante.
describe("modo agente", () => {
	it("no genera el aviso de 'escribió': tiene el suyo", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "modo_agente",
			exito: true,
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});
});

// Review de Codex (P2): cartera ya reasignó el crédito pero el caso local
// todavía nombra al asesor anterior. Enlazarlo mandaba al nuevo dueño a un
// NOT_FOUND (getCasoCobroById exige ser el responsable).
describe("enlace al caso tras una reasignación", () => {
	it("si el caso local es de otro asesor, el aviso va sin enlace", async () => {
		casoEncontrado = [{ id: "caso-1", responsableCobros: "asesor-anterior" }];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
			exito: true,
		});
		expect(insertadas).toHaveLength(1);
		expect(insertadas[0].assignedTo).toBe("user-1");
		expect(insertadas[0].relatedEntityId).toBeUndefined();
		expect(insertadas[0].redirectPage).toBeUndefined();
	});

	it("un supervisor de cobros puede abrir cualquier caso: conserva el enlace", async () => {
		casoEncontrado = [{ id: "caso-1", responsableCobros: "asesor-anterior" }];
		usuarioEncontrado = [
			{ id: "user-1", name: "Supervisora", role: "cobros_supervisor" },
		];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
			exito: true,
		});
		expect(insertadas[0].relatedEntityId).toBe("caso-1");
	});
});
