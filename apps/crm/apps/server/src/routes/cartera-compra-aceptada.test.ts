import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.CARTERA_RELAY_SECRET = "secreto-de-prueba";

/** Lo que devuelve el `returning()` del insert: una fila, o ninguna si ya existía. */
let filaInsertada: Array<{ id: string }> = [];
/** Cola de resultados para los `select(...).limit()`, en orden de llamada. */
let resultadosDeSelect: unknown[][] = [];
/** Lo que devuelve el `update(...).returning()` del refresco de la foto. */
let filaRefrescada: Array<{ id: string }> = [];
const valoresInsertados: Record<string, unknown>[] = [];
const valoresRefrescados: Record<string, unknown>[] = [];

const createNotification = mock(async (_datos: Record<string, unknown>) => ({
	id: "notificacion-1",
}));

mock.module("../lib/notificaciones", () => ({ createNotification }));

const select = () => ({
	from: () => ({
		where: () => ({
			limit: async () => resultadosDeSelect.shift() ?? [],
		}),
	}),
});

mock.module("../db", () => ({
	db: {
		// El aviso a jurídico se decide adentro, con el candado de la batería.
		transaction: async (trabajo: (tx: unknown) => Promise<unknown>) =>
			trabajo({ execute: async () => undefined, select }),
		insert: () => ({
			values: (valores: Record<string, unknown>) => {
				valoresInsertados.push(valores);
				return {
					onConflictDoNothing: () => ({
						returning: async () => filaInsertada,
					}),
				};
			},
		}),
		select,
		update: () => ({
			set: (valores: Record<string, unknown>) => {
				valoresRefrescados.push(valores);
				return {
					where: () => ({ returning: async () => filaRefrescada }),
				};
			},
		}),
	},
}));

const { default: app } = await import("./cartera-compra-aceptada");

const CUERPO = {
	inversionista: {
		id: 42,
		nombre: "ANA CAROLINA REITER DE CHUY",
		dpi: "3703995870101",
		email: "ana@ejemplo.com",
		celular: "50212345678",
	},
	compra: {
		creditos: [
			{
				creditoId: 900,
				numeroCreditoSifco: "01010214117590",
				clienteNombre: "JOSUÉ NAVARRO",
				monto: "7634.27",
			},
			{
				creditoId: 100,
				numeroCreditoSifco: "01010214117591",
				clienteNombre: "EDDI VÁSQUEZ",
				monto: "142365.73",
			},
		],
		montoTotal: "150000.00",
		modalidad: "Reinversión de Capital",
		facturacion: "Propia",
		aceptadaEn: "2026-09-17T17:08:00.000Z",
		aceptadaPor: "pablo.z@clubcashin.com",
	},
};

function pedir(cuerpo: unknown, secreto = "secreto-de-prueba") {
	return app.request("/", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-cartera-relay-secret": secreto,
		},
		body: JSON.stringify(cuerpo),
	});
}

beforeEach(() => {
	filaInsertada = [];
	filaRefrescada = [];
	resultadosDeSelect = [];
	valoresInsertados.length = 0;
	valoresRefrescados.length = 0;
	createNotification.mockClear();
});

describe("aviso de compra aceptada", () => {
	test("rechaza el aviso sin el secreto compartido", async () => {
		const res = await pedir(CUERPO, "otro-secreto");

		expect(res.status).toBe(401);
		expect(createNotification).not.toHaveBeenCalled();
	});

	test("rechaza un cuerpo que no trae créditos", async () => {
		const res = await pedir({
			inversionista: CUERPO.inversionista,
			compra: { ...CUERPO.compra, creditos: [] },
		});

		expect(res.status).toBe(400);
	});

	test("abre la batería y le avisa a jurídico", async () => {
		filaInsertada = [{ id: "bateria-1" }];
		resultadosDeSelect = [[{ id: "usuario-juridico", role: "juridico" }]];

		const res = await pedir(CUERPO);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			success: true,
			batchId: "bateria-1",
			repetida: false,
		});
		expect(createNotification).toHaveBeenCalledTimes(1);
		expect(createNotification.mock.calls[0][0]).toMatchObject({
			assignedToRole: "juridico",
			redirectPage: "investor_contracts",
			// Sin la entidad relacionada la notificación no lleva a ningún lado.
			relatedEntityId: "bateria-1",
		});
	});

	test("la llave de la compra ordena los créditos, para que el reintento calce", async () => {
		filaInsertada = [{ id: "bateria-1" }];
		resultadosDeSelect = [[{ id: "usuario-juridico", role: "juridico" }]];

		await pedir(CUERPO);

		// Los créditos llegaron como 900 y 100: la llave los ordena.
		expect(valoresInsertados[0]?.purchaseKey).toBe("100-900");
	});

	/** La batería que ya existía, con la fecha de aceptación de este mismo aviso. */
	const MISMA_ACEPTACION = {
		id: "bateria-1",
		status: "pendiente",
		acceptedAt: new Date(CUERPO.compra.aceptadaEn),
	};

	test("un reintento no abre otra batería ni vuelve a notificar", async () => {
		// Sin fila devuelta: el índice único la rechazó porque ya existía.
		filaInsertada = [];
		resultadosDeSelect = [[MISMA_ACEPTACION]];

		const res = await pedir(CUERPO);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			batchId: "bateria-1",
			repetida: true,
		});
		expect(createNotification).not.toHaveBeenCalled();
	});

	test("el reintento refresca la foto de la batería abierta", async () => {
		filaInsertada = [];
		resultadosDeSelect = [[MISMA_ACEPTACION]];

		await pedir(CUERPO);

		// Lo que pudo haberse completado en cartera entre un aviso y el otro.
		expect(valoresRefrescados[0]).toMatchObject({
			investorEmail: "ana@ejemplo.com",
			montoTotal: "150000.00",
		});
		// Pero no la mueve de estado: sigue siendo el mismo trabajo.
		expect(valoresRefrescados[0]).not.toHaveProperty("status");
	});

	test("una batería ya cerrada no se refresca, pero el aviso se acepta", async () => {
		filaInsertada = [];
		resultadosDeSelect = [
			[{ ...MISMA_ACEPTACION, id: "bateria-cerrada", status: "completada" }],
		];

		const res = await pedir(CUERPO);

		expect(await res.json()).toMatchObject({
			batchId: "bateria-cerrada",
			repetida: true,
		});
		expect(valoresRefrescados).toHaveLength(0);
	});

	test("otra compra sobre los mismos créditos reabre la batería y vuelve a avisar", async () => {
		filaInsertada = [];
		resultadosDeSelect = [
			// La que existía es de una aceptación anterior y ya estaba cerrada.
			[
				{
					id: "bateria-1",
					status: "completada",
					acceptedAt: new Date("2026-08-01T10:00:00.000Z"),
				},
			],
			[{ id: "usuario-juridico", role: "juridico" }],
		];
		filaRefrescada = [{ id: "bateria-1" }];

		const res = await pedir(CUERPO);

		expect(await res.json()).toMatchObject({
			batchId: "bateria-1",
			repetida: true,
		});
		// Vuelve a ser trabajo de jurídico hasta que le dé "Listo".
		expect(valoresRefrescados[0]).toMatchObject({
			status: "pendiente",
			acceptedAt: new Date(CUERPO.compra.aceptadaEn),
			completedAt: null,
			montoTotal: "150000.00",
		});
		// Es trabajo nuevo: jurídico tiene que enterarse.
		expect(createNotification).toHaveBeenCalledTimes(1);
	});

	test("dos avisos de la misma compra nueva a la vez: sólo el que la registra avisa", async () => {
		filaInsertada = [];
		resultadosDeSelect = [
			[
				{
					id: "bateria-1",
					status: "completada",
					acceptedAt: new Date("2026-08-01T10:00:00.000Z"),
				},
			],
		];
		// El otro aviso ya movió la aceptación: este update no encuentra la fila.
		filaRefrescada = [];

		const res = await pedir(CUERPO);

		expect(await res.json()).toMatchObject({ repetida: true });
		expect(createNotification).not.toHaveBeenCalled();
	});

	test("la batería recién abierta no avisa dos veces si otro aviso se le adelantó", async () => {
		filaInsertada = [{ id: "bateria-1" }];
		resultadosDeSelect = [
			[{ id: "usuario-juridico", role: "juridico" }],
			// Ya con el candado: el reintento que se cruzó dejó su aviso.
			[{ id: "aviso-del-otro" }],
		];

		const res = await pedir(CUERPO);

		expect(res.status).toBe(200);
		expect(createNotification).not.toHaveBeenCalled();
	});

	test("el reintento que encuentra la batería abierta sin aviso lo crea, una vez", async () => {
		filaInsertada = [];
		resultadosDeSelect = [
			[MISMA_ACEPTACION],
			// Sin aviso todavía.
			[],
			[{ id: "usuario-juridico", role: "juridico" }],
			// Con el candado, sigue sin aviso.
			[],
		];

		await pedir(CUERPO);

		expect(createNotification).toHaveBeenCalledTimes(1);
	});

	test("sin usuario de jurídico ni admin, la batería igual queda abierta", async () => {
		filaInsertada = [{ id: "bateria-1" }];
		// Ni jurídico ni admin: las dos consultas vuelven vacías.
		resultadosDeSelect = [[], []];

		const res = await pedir(CUERPO);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ batchId: "bateria-1" });
		expect(createNotification).not.toHaveBeenCalled();
	});

	test("un aviso de una aceptación anterior a la guardada no toca la batería", async () => {
		filaInsertada = [];
		resultadosDeSelect = [
			[
				{
					id: "bateria-1",
					status: "pendiente",
					// Ya se registró una compra más nueva sobre los mismos créditos.
					acceptedAt: new Date("2026-10-01T10:00:00.000Z"),
				},
			],
		];

		const res = await pedir(CUERPO);

		expect(await res.json()).toMatchObject({
			batchId: "bateria-1",
			repetida: true,
		});
		expect(valoresRefrescados).toHaveLength(0);
		expect(createNotification).not.toHaveBeenCalled();
	});
});
