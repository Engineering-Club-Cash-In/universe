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
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { notifications } from "../db/schema/notifications";

let estadoInmovilizacionMock: string | null = "pendiente_aprobacion";
let notificacionesInsertadas: Record<string, unknown>[][] = [];
let supervisoresMock = ["sup-1", "sup-2"];

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
		transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb()),
	};
}

mock.module("../db", () => ({ db: mockDb() }));
mock.module("./cobros-notif-helpers", () => ({
	obtenerSupervisoresCobros: async () => supervisoresMock,
}));

const { notificarInmovilizacionPendiente } = await import(
	"./inmovilizacion-notif"
);

function reset() {
	estadoInmovilizacionMock = "pendiente_aprobacion";
	notificacionesInsertadas = [];
	supervisoresMock = ["sup-1", "sup-2"];
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
