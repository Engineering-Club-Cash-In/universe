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
				where: () => ({
					limit: async () => {
						selectsHechos += 1;
						if (selectsHechos === 1) return yaAvisado;
						if (selectsHechos === 2) return casoEncontrado;
						return usuarioEncontrado;
					},
				}),
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
		expect(llaveDedupSesionBot(SESION)).toBe(`bot:sesion:${SESION}`);
	});
});

describe("cuándo NO se avisa", () => {
	it("sin sesión (un acceso_fallido) no hay a qué colgarse", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: null,
			numeroSifco: "0101",
			accion: "buscar_cliente",
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});

	it("sin numero_sifco todavía no se sabe de qué crédito se trata", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: null,
			accion: "listar_creditos",
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
		});
		expect(insertadas).toHaveLength(0);
		expect(llamadasCartera).toHaveLength(0);
	});

	it("un crédito sin caso de cobros no tiene a dónde navegar", async () => {
		casoEncontrado = [];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		});
		expect(insertadas).toHaveLength(0);
	});

	it("un asesor sin usuario del CRM enlazado por correo no recibe nada", async () => {
		usuarioEncontrado = [];
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		});
		expect(insertadas).toHaveLength(0);
	});

	it("un crédito sin asesor en cartera tampoco", async () => {
		asesorEmail = null;
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "menu_credito",
		});
		expect(insertadas).toHaveLength(0);
	});
});

describe("cuando sí se avisa", () => {
	it("le escribe al asesor dueño, con la llave de la conversación", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "01010214119660",
			accion: "estado_cuenta",
		});
		expect(insertadas).toHaveLength(1);
		const fila = insertadas[0];
		expect(fila.cobrosTipo).toBe("bot_cliente_escribio");
		expect(fila.cobrosDedupKey).toBe(`bot:sesion:${SESION}`);
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
		});
		expect(llamadasCartera).toHaveLength(1);
		expect(llamadasCartera[0].useCache).toBe(false);
	});

	it("una acción desconocida igual avisa, con texto genérico", async () => {
		await avisarAsesorPorInteraccionBot({
			sesionId: SESION,
			numeroSifco: "0101",
			accion: "una_accion_nueva_del_bot",
		});
		expect(insertadas).toHaveLength(1);
		expect(String(insertadas[0].descripcion)).toContain(
			"escribió al bot de cobros",
		);
	});
});
