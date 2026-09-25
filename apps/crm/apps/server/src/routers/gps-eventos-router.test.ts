/**
 * CB-119 — getGpsEventosCaso: historial de eventos GPS en la Ficha 360.
 * Mock de `db` propio: identifica ramas por TABLA (`.from(tabla)`), igual
 * que gps-integracion.test.ts.
 */
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { gpsEventos } from "../db/schema/gps-eventos";
import type { Context } from "../lib/context";

let rolUsuarioMock = "cobros";
let responsableCasoMock = "user-test";
let eventosFilasMock: Record<string, unknown>[] = [];
let numeroCreditoSifcoMock: string | null = "01010214100000";

function mockDb() {
	return {
		select: (campos?: Record<string, unknown>) => ({
			from: (tabla: unknown) => {
				if (tabla === user) {
					return {
						where: () => ({
							limit: async () => [{ id: "user-test", role: rolUsuarioMock }],
						}),
					};
				}
				if (tabla === casosCobros) {
					const camposNombres = campos ? Object.keys(campos) : [];
					// getGpsEventosCaso trae numeroCreditoSifco para el guard de
					// cartera, aparte del select({id}) de assertAccesoCasoCobro.
					if (camposNombres.includes("numeroCreditoSifco")) {
						return {
							where: () => ({
								limit: async () =>
									numeroCreditoSifcoMock
										? [{ numeroCreditoSifco: numeroCreditoSifcoMock }]
										: [],
							}),
						};
					}
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
const { carteraBackClient } = await import("../services/cartera-back-client");

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
		numeroCreditoSifcoMock = "01010214100000";
		mock.restore();
	});

	it("asesor con acceso al caso Y asignado en cartera: devuelve el historial", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
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
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
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

	it("caso auto-creado sobre un crédito de OTRO asesor en cartera: FORBIDDEN, no expone lat/lon", async () => {
		// assertAccesoCasoCobro pasa (responsableCasoMock = user-test, el caso
		// se auto-creó con el usuario que consultó), pero cartera dice que el
		// asesor real es otro — mismo hallazgo que ya corrigió
		// assertCreditoAsignadoEnCarteraPorSifco en routers/wialon.ts.
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "otro.asesor@example.com" },
		} as never);
		eventosFilasMock = [
			{
				id: "evento-1",
				tipo: "sin_reportar",
				wialonUnitId: 1,
				ocurridoAt: new Date(),
				lat: 14.6,
				lon: -90.5,
				velocidadKmh: null,
				notificado: true,
			},
		];

		await expect(
			call(
				gpsEventosRouter.getGpsEventosCaso,
				{ casoCobroId: CASO_ID, limit: 20 },
				{ context: ctx("cobros") },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("caso sin numeroCreditoSifco: no llama a cartera, cae directo (nada que verificar)", async () => {
		numeroCreditoSifcoMock = null;
		const getCreditoSpy = spyOn(carteraBackClient, "getCredito");
		eventosFilasMock = [];

		const res = await call(
			gpsEventosRouter.getGpsEventosCaso,
			{ casoCobroId: CASO_ID, limit: 20 },
			{ context: ctx("cobros") },
		);

		expect(res).toEqual([]);
		expect(getCreditoSpy).not.toHaveBeenCalled();
	});
});
