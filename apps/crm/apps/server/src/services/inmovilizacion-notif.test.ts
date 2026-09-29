/**
 * CB-041 — notificarInmovilizacionPendiente: el lock de fila (SELECT ...
 * FOR UPDATE dentro de una transacción) que cierra la ventana de carrera
 * con decidirInmovilizacion/cancelarSolicitud (review de Codex, PR #1758).
 * Mock de `db` propio, mismo criterio que inmovilizacion-unidad.test.ts:
 * identifica ramas por TABLA. `db.transaction` recibe un `tx` con la misma
 * forma que `db` — el mock no simula el lock en sí (no hay concurrencia
 * real en un mock in-memory), solo que el código pasa por `for("update")`
 * y que el INSERT queda condicionado al estado leído.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { casosCobros } from "../db/schema/cobros";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { notifications } from "../db/schema/notifications";
import { moduloAccesoFalso } from "../lib/acceso-caso-cobro.mock";

let estadoInmovilizacionMock: string | null = "pendiente_aprobacion";
let notificacionesInsertadas: Record<string, unknown>[][] = [];
let notificacionesActualizadas: { set: Record<string, unknown> }[] = [];
let supervisoresMock = ["sup-1", "sup-2"];
// Avisos abiertos de "llamar al cliente" (reconciliarAvisosLlamarCliente) y el
// dueño del crédito en cartera, ya resuelto a usuario del CRM.
type AvisoAbierto = {
	id: string;
	casoCobroId: string;
	assignedTo: string | null;
	numeroCreditoSifco: string | null;
};
// Cada lectura de avisos toma la siguiente foto de la cola (la última se repite).
let lecturasAvisos: AvisoAbierto[][] = [];
// Resultado de cada compare-and-set, en orden (true = movió la fila).
let resultadosCas: boolean[] = [];
function siguienteLectura(): AvisoAbierto[] {
	return lecturasAvisos.length > 1
		? (lecturasAvisos.shift() ?? [])
		: (lecturasAvisos[0] ?? []);
}
let duenoEnCarteraMock: string | null = null;

function mockDb() {
	return {
		select: () => ({
			from: (tabla: unknown) => {
				if (tabla === inmovilizacionesUnidad) {
					return {
						where: () => ({
							for: () => ({
								limit: async () =>
									estadoInmovilizacionMock
										? [{ estado: estadoInmovilizacionMock }]
										: [],
							}),
						}),
					};
				}
				if (tabla === casosCobros) {
					return {
						where: () => ({}),
					};
				}
				if (tabla === notifications) {
					return {
						innerJoin: () => ({ where: async () => siguienteLectura() }),
					};
				}
				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
		insert: (tabla: unknown) => {
			if (tabla === notifications) {
				return {
					values: (filas: Record<string, unknown>[]) => {
						notificacionesInsertadas.push(filas);
						return Promise.resolve();
					},
				};
			}
			throw new Error(`insert en tabla no mockeada: ${String(tabla)}`);
		},
		update: (tabla: unknown) => {
			if (tabla === notifications) {
				return {
					set: (cambios: Record<string, unknown>) => {
						notificacionesActualizadas.push({ set: cambios });
						return {
							// Awaitable directo (los UPDATE sin RETURNING) y con
							// `.returning()` para el compare-and-set de la reconciliación.
							where: () => {
								const movio =
									resultadosCas.length > 0 ? resultadosCas.shift() : true;
								const resultado = Promise.resolve() as Promise<void> & {
									returning: () => Promise<{ id: string }[]>;
								};
								resultado.returning = async () => (movio ? [{ id: "n" }] : []);
								return resultado;
							},
						};
					},
				};
			}
			throw new Error(`update en tabla no mockeada: ${String(tabla)}`);
		},
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb()),
	};
}

mock.module("../db", () => ({ db: mockDb() }));
mock.module("./cobros-notif-helpers", () => ({
	obtenerSupervisoresCobros: async () => supervisoresMock,
}));
mock.module("../lib/acceso-caso-cobro", () =>
	moduloAccesoFalso({
		tieneAcceso: () => true,
		duenoUsuario: () => duenoEnCarteraMock,
	}),
);

const { notificarInmovilizacionPendiente, reconciliarAvisosLlamarCliente } =
	await import("./inmovilizacion-notif");

function reset() {
	estadoInmovilizacionMock = "pendiente_aprobacion";
	notificacionesInsertadas = [];
	notificacionesActualizadas = [];
	supervisoresMock = ["sup-1", "sup-2"];
	lecturasAvisos = [];
	resultadosCas = [];
	duenoEnCarteraMock = null;
}

const params = {
	inmovilizacionId: "id-1",
	casoCobroId: "caso-1",
	accion: "apagado" as const,
	motivo: "Cliente incontactable",
	solicitadoPorUserId: "asesor-1",
};

describe("CB-041 — notificarInmovilizacionPendiente", () => {
	afterEach(reset);

	it("estado sigue pendiente_aprobacion: inserta un aviso por supervisor", async () => {
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(1);
		expect(notificacionesInsertadas[0]).toHaveLength(2);
	});

	it("ya fue decidida (aprobada) antes del INSERT: no crea avisos huérfanos (review de Codex)", async () => {
		// Ventana entre el commit de solicitarInmovilizacion y esta llamada:
		// un supervisor ya decidió. Sin el re-chequeo, esto insertaba avisos
		// `pending` que resolverPendientesInmovilizacion ya no podía cerrar
		// (corrió antes de que existieran).
		estadoInmovilizacionMock = "aprobada";
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("ya fue rechazada antes del INSERT: no crea avisos huérfanos", async () => {
		estadoInmovilizacionMock = "rechazada";
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("solicitud cancelada antes del INSERT: no crea avisos huérfanos", async () => {
		estadoInmovilizacionMock = "cancelada";
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("la fila ya no existe (caso límite): no crea avisos", async () => {
		estadoInmovilizacionMock = null;
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});

	it("sin supervisores: no inserta nada (pero tampoco falla)", async () => {
		supervisoresMock = [];
		await notificarInmovilizacionPendiente(params);
		expect(notificacionesInsertadas).toHaveLength(0);
	});
});

describe("reconciliarAvisosLlamarCliente — el aviso sigue al dueño en cartera (review de Codex, PR #1765)", () => {
	afterEach(reset);

	it("cartera reasignó el crédito: el aviso pasa al dueño de hoy", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-viejo",
					numeroCreditoSifco: "0101",
				},
			],
		];
		duenoEnCarteraMock = "asesor-nuevo";

		const movidos = await reconciliarAvisosLlamarCliente();

		expect(movidos).toBe(1);
		expect(notificacionesActualizadas).toHaveLength(1);
		expect(notificacionesActualizadas[0]?.set.assignedTo).toBe("asesor-nuevo");
	});

	it("el aviso ya es del dueño: no toca nada", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-nuevo",
					numeroCreditoSifco: "0101",
				},
			],
		];
		duenoEnCarteraMock = "asesor-nuevo";

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(0);
	});

	it("el dueño no tiene usuario en el CRM: el aviso se queda donde está", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "quien-pidio",
					numeroCreditoSifco: "0101",
				},
			],
		];
		duenoEnCarteraMock = null;

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(0);
	});

	it("otra reconciliación lo movió entre la lectura y el UPDATE: relee y no lo pisa", async () => {
		// 1ª lectura: el aviso está en A y el dueño en cartera es C. Otra
		// reconciliación lo mueve a C antes del UPDATE, así que el compare-and-set
		// sobre "A" no encuentra la fila. 2ª lectura: ya está en C, nada que hacer.
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-A",
					numeroCreditoSifco: "0101",
				},
			],
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-C",
					numeroCreditoSifco: "0101",
				},
			],
		];
		resultadosCas = [false];
		duenoEnCarteraMock = "asesor-C";

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(1); // un solo intento, el que falló
	});

	it("si el compare-and-set sigue fallando, se rinde a las 3 vueltas sin pisar nada", async () => {
		lecturasAvisos = [
			[
				{
					id: "n1",
					casoCobroId: "caso-1",
					assignedTo: "asesor-A",
					numeroCreditoSifco: "0101",
				},
			],
		];
		resultadosCas = [false, false, false, false];
		duenoEnCarteraMock = "asesor-C";

		expect(await reconciliarAvisosLlamarCliente()).toBe(0);
		expect(notificacionesActualizadas).toHaveLength(3);
	});

	it("con una lista vacía de casos no consulta nada", async () => {
		expect(await reconciliarAvisosLlamarCliente([])).toBe(0);
	});
});

