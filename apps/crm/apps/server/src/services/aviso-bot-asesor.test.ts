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
let casoEncontrado: { id: string }[] = [{ id: "caso-1" }];
/** Qué devuelve el SELECT de usuario del CRM por correo. */
let usuarioEncontrado: { id: string; name: string }[] = [
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

const { avisarAsesorPorInteraccionBot, llaveDedupSesionBot } = await import(
	"./aviso-bot-asesor"
);

const SESION = "aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000";

beforeEach(() => {
	llamadasCartera.length = 0;
	insertadas.length = 0;
	selectsHechos = 0;
	yaAvisado = [];
	casoEncontrado = [{ id: "caso-1" }];
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

	it("una petición que el bot RECHAZÓ no avisa ni quema la llave", async () => {
		// El numeroSifco sale del body: una sesión válida con el crédito de otro
		// cliente llega hasta acá y el endpoint la rechaza. Sin este filtro se
		// avisaba al asesor ajeno y se consumía la dedup de la sesión, dejando
		// al asesor correcto sin aviso (review de Codex, P2).
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
			exito: false,
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
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

describe("cuando sí se avisa", () => {
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
