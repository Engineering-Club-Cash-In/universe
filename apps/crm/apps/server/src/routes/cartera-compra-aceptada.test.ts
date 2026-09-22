import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env.CARTERA_RELAY_SECRET = "secreto-de-prueba";

/** Lo que devuelve el `returning()` del insert: una fila, o ninguna si ya existía. */
let filaInsertada: Array<{ id: string }> = [];
/** Cola de resultados para los `select(...).limit()`, en orden de llamada. */
let resultadosDeSelect: unknown[][] = [];
const valoresInsertados: Record<string, unknown>[] = [];

const createNotification = mock(async (_datos: Record<string, unknown>) => ({
	id: "notificacion-1",
}));

mock.module("../lib/notificaciones", () => ({ createNotification }));
mock.module("../db", () => ({
	db: {
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
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => resultadosDeSelect.shift() ?? [],
				}),
			}),
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
	resultadosDeSelect = [];
	valoresInsertados.length = 0;
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
		});
	});

	test("la llave de la compra ordena los créditos, para que el reintento calce", async () => {
		filaInsertada = [{ id: "bateria-1" }];
		resultadosDeSelect = [[{ id: "usuario-juridico", role: "juridico" }]];

		await pedir(CUERPO);

		// Los créditos llegaron como 900 y 100: la llave los ordena.
		expect(valoresInsertados[0]?.purchaseKey).toBe("100-900");
	});

	test("un reintento no abre otra batería ni vuelve a notificar", async () => {
		// Sin fila devuelta: el índice único la rechazó porque ya existía.
		filaInsertada = [];
		resultadosDeSelect = [[{ id: "bateria-1" }]];

		const res = await pedir(CUERPO);

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			batchId: "bateria-1",
			repetida: true,
		});
		expect(createNotification).not.toHaveBeenCalled();
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
});
