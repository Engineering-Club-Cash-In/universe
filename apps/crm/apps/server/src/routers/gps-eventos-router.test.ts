/**
 * CB-119 — getGpsEventosCaso: historial de eventos GPS en la Ficha 360.
 * Mock de `db` propio: identifica ramas por TABLA (`.from(tabla)`), igual
 * que gps-integracion.test.ts.
 */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { gpsEventos } from "../db/schema/gps-eventos";
import type { Context } from "../lib/context";

let rolUsuarioMock = "cobros";
let responsableCasoMock = "user-test";
let eventosFilasMock: Record<string, unknown>[] = [];

function mockDb() {
	return {
		select: () => ({
			from: (tabla: unknown) => {
				if (tabla === user) {
					return {
						where: () => ({
							limit: async () => [{ id: "user-test", role: rolUsuarioMock }],
						}),
					};
				}
				if (tabla === casosCobros) {
					// assertAccesoCasoCobro: select({id}).from(casosCobros).where().limit()
					return {
						where: () => ({
							limit: async () =>
								rolUsuarioMock === "admin" ||
								rolUsuarioMock === "cobros_supervisor" ||
								responsableCasoMock === "user-test"
									? [{ id: "caso-1" }]
									: [],
						}),
					};
				}
				if (tabla === gpsEventos) {
					return {
						where: () => ({
							orderBy: () => ({
								limit: async () => eventosFilasMock,
							}),
						}),
					};
				}
				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
	};
}

mock.module("../db", () => ({ db: mockDb() }));

const { gpsEventosRouter } = await import("./gps-eventos-router");

function ctx(role: string): Context {
	rolUsuarioMock = role;
	return {
		session: { user: { id: "user-test", email: "u@example.com" } },
		user: { id: "user-test", email: "u@example.com", role },
	} as unknown as Context;
}

const CASO_ID = "11111111-1111-1111-1111-111111111111";

describe("CB-119 — getGpsEventosCaso", () => {
	afterEach(() => {
		eventosFilasMock = [];
		responsableCasoMock = "user-test";
	});

	it("asesor con acceso al caso: devuelve el historial", async () => {
		eventosFilasMock = [
			{
				id: "evento-1",
				tipo: "sin_reportar",
				wialonUnitId: 12345,
				ocurridoAt: new Date("2026-09-24T10:00:00.000Z"),
				lat: 14.6,
				lon: -90.5,
				velocidadKmh: null,
				notificado: true,
			},
		];

		const res = await call(
			gpsEventosRouter.getGpsEventosCaso,
			{ casoCobroId: CASO_ID, limit: 20 },
			{ context: ctx("cobros") },
		);

		expect(res).toHaveLength(1);
		expect(res[0]?.tipo).toBe("sin_reportar");
		expect(res[0]?.notificado).toBe(true);
	});

	it("admin puede ver el historial de cualquier caso", async () => {
		eventosFilasMock = [];
		const res = await call(
			gpsEventosRouter.getGpsEventosCaso,
			{ casoCobroId: CASO_ID, limit: 20 },
			{ context: ctx("admin") },
		);
		expect(res).toEqual([]);
	});

	it("cobros_supervisor puede ver el historial de cualquier caso", async () => {
		eventosFilasMock = [];
		const res = await call(
			gpsEventosRouter.getGpsEventosCaso,
			{ casoCobroId: CASO_ID, limit: 20 },
			{ context: ctx("cobros_supervisor") },
		);
		expect(res).toEqual([]);
	});

	it("asesor SIN acceso al caso: NOT_FOUND", async () => {
		responsableCasoMock = "otro-usuario";

		await expect(
			call(
				gpsEventosRouter.getGpsEventosCaso,
				{ casoCobroId: CASO_ID, limit: 20 },
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("respeta el límite pedido", async () => {
		eventosFilasMock = [
			{
				id: "e1",
				tipo: "ignicion",
				wialonUnitId: 1,
				ocurridoAt: new Date(),
				lat: null,
				lon: null,
				velocidadKmh: null,
				notificado: false,
			},
		];
		const res = await call(
			gpsEventosRouter.getGpsEventosCaso,
			{ casoCobroId: CASO_ID, limit: 5 },
			{ context: ctx("cobros") },
		);
		expect(res).toHaveLength(1);
	});
});
