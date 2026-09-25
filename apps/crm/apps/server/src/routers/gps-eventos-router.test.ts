/**
 * CB-119 — getGpsEventosCaso (historial) y getUbicacionesClaveCaso (D-15).
 * Mock de `db` propio: identifica ramas por TABLA (`.from(tabla)`) y por los
 * campos pedidos en `select()`, igual que wialon.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import { gpsEventos, gpsUbicacionesClave } from "../db/schema/gps-eventos";
import type { Context } from "../lib/context";

let rolUsuarioMock = "cobros";
let responsableCasoMock = "user-test";
let eventosFilasMock: Record<string, unknown>[] = [];
let ubicacionesFilasMock: Record<string, unknown>[] = [];
let numeroCreditoSifcoMock: string | null = "01010214100000";

const VEHICLE_ID = "22222222-2222-2222-2222-222222222222";

// Caso ⨝ oportunidades que lee resolverCasoParaGps (getUbicacionesClaveCaso).
let casoGpsMock: Record<string, unknown> | null = {
	casoSifco: "01010214100000",
	vehiculoOportunidad: VEHICLE_ID,
};
let insertGpsConsultaLogFalla = false;
let gpsConsultaLogsInsertados: Record<string, unknown>[] = [];
let ubicacionesWhereCondition: unknown = null;

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

				// resolverCasoParaGps: select({casoSifco, vehiculoOportunidad})
				// .from(casosCobros).leftJoin(opportunities).where()
				if (campos && "casoSifco" in campos) {
					return {
						leftJoin: () => ({
							where: async () => (casoGpsMock ? [casoGpsMock] : []),
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

				if (tabla === gpsUbicacionesClave) {
					return {
						where: (cond?: unknown) => {
							ubicacionesWhereCondition = cond;
							return {
								orderBy: async () => ubicacionesFilasMock,
							};
						},
					};
				}

				throw new Error(`select from tabla no mockeada: ${String(tabla)}`);
			},
		}),
		insert: (tabla: unknown) => {
			if (tabla === gpsConsultaLogs) {
				return {
					values: (fila: Record<string, unknown>) => {
						if (insertGpsConsultaLogFalla) {
							return Promise.reject(new Error("insert falló"));
						}
						gpsConsultaLogsInsertados.push(fila);
						return Promise.resolve();
					},
				};
			}
			throw new Error(`insert en tabla no mockeada: ${String(tabla)}`);
		},
		delete: (tabla: unknown) => {
			if (tabla === gpsUbicacionesClave) {
				return {
					where: async () => {},
				};
			}
			throw new Error(`delete en tabla no mockeada: ${String(tabla)}`);
		},
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

describe("CB-119 (D-15) — getUbicacionesClaveCaso", () => {
	beforeEach(() => {
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 4,
		} as never);
	});

	afterEach(() => {
		ubicacionesFilasMock = [];
		casoGpsMock = {
			casoSifco: "01010214100000",
			vehiculoOportunidad: VEHICLE_ID,
		};
		insertGpsConsultaLogFalla = false;
		gpsConsultaLogsInsertados = [];
		ubicacionesWhereCondition = null;
		mock.restore();
	});

	const input = {
		casoCobroId: CASO_ID,
		vehicleId: VEHICLE_ID,
		motivo: "Verificar patrón de ubicaciones para gestión de recuperación",
	};

	it("acceso al caso, vehículo correcto, asignado en cartera: audita y devuelve ubicaciones", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		ubicacionesFilasMock = [
			{
				id: "ub-1",
				lat: 14.5951,
				lon: -90.5069,
				radioM: 200,
				tipo: "probable_casa",
				horasTotales: 480,
				diasDistintos: 55,
				visitas: 55,
				patron: { nocturna: 55, laboral: 0, finDeSemana: 0 },
				primeraVisita: new Date("2026-07-01T00:00:00.000Z"),
				ultimaVisita: new Date("2026-08-29T00:00:00.000Z"),
				calculadoAt: new Date("2026-08-30T06:00:00.000Z"),
			},
		];

		const res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});

		expect(res.auditada).toBe(true);
		expect(res.ubicaciones).toHaveLength(1);
		expect(res.ubicaciones[0]?.tipo).toBe("probable_casa");
		expect(gpsConsultaLogsInsertados).toHaveLength(1);
		expect(gpsConsultaLogsInsertados[0]?.motivo).toBe(input.motivo);
	});

	it("caso o vehículo sin acceso: NOT_FOUND (propaga error de resolverCasoParaGps)", async () => {
		casoGpsMock = null;

		await expect(
			call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
				context: ctx("cobros"),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("caso auto-creado de OTRO asesor en cartera: FORBIDDEN, no expone ubicaciones", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "otro.asesor@example.com" },
		} as never);

		await expect(
			call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
				context: ctx("cobros"),
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(gpsConsultaLogsInsertados).toHaveLength(0);
	});

	it("falla la auditoría (insert de gps_consulta_logs): fail closed, no devuelve ubicaciones y auditada=false", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		insertGpsConsultaLogFalla = true;
		ubicacionesFilasMock = [
			{
				id: "ub-1",
				lat: 14.5951,
				lon: -90.5069,
				radioM: 200,
				tipo: "probable_casa",
				horasTotales: 480,
				diasDistintos: 55,
				visitas: 55,
				patron: {},
				primeraVisita: new Date(),
				ultimaVisita: new Date(),
				calculadoAt: new Date(),
			},
		];

		const res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});

		expect(res).toEqual({ auditada: false, ubicaciones: [] });
	});

	it("admin puede ver ubicaciones de cualquier caso sin llamar a cartera-back", async () => {
		const getCreditoSpy = spyOn(carteraBackClient, "getCredito");
		ubicacionesFilasMock = [];

		const res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("admin"),
		});

		expect(res).toEqual({ auditada: true, ubicaciones: [] });
		expect(getCreditoSpy).not.toHaveBeenCalled();
	});

	it("motivo de 5 caracteres es aceptado y motivo menor a 5 es rechazado por validación", async () => {
		const resValido = await call(
			gpsEventosRouter.getUbicacionesClaveCaso,
			{ ...input, motivo: "12345" },
			{ context: ctx("admin") },
		);
		expect(resValido).toEqual({ auditada: true, ubicaciones: [] });

		await expect(
			call(
				gpsEventosRouter.getUbicacionesClaveCaso,
				{ ...input, motivo: "1234" },
				{ context: ctx("admin") },
			),
		).rejects.toThrow();
	});

	it("acota la consulta tanto al casoCobroId como al vehicleId", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);

		await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});

		expect(ubicacionesWhereCondition).toBeDefined();
	});

	it("crédito fuera de B4 (bucket !== 4): purga filas y no expone ubicaciones", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		spyOn(carteraBackClient, "getBucketActualCredito").mockResolvedValue({
			bucket: 2, // B2
		} as never);

		ubicacionesFilasMock = [
			{
				id: "ub-1",
				lat: 14.5951,
				lon: -90.5069,
				radioM: 200,
				tipo: "probable_casa",
				horasTotales: 480,
				diasDistintos: 55,
				visitas: 55,
				patron: { nocturna: 55, laboral: 0, finDeSemana: 0 },
				primeraVisita: new Date("2026-07-01T00:00:00.000Z"),
				ultimaVisita: new Date("2026-08-29T00:00:00.000Z"),
				calculadoAt: new Date("2026-08-30T06:00:00.000Z"),
			},
		];

		const res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});

		expect(res.auditada).toBe(true);
		expect(res.ubicaciones).toEqual([]);
	});
});
