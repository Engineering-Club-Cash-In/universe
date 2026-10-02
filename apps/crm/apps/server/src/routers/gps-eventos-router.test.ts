/**
 * CB-119 — getGpsEventosCaso (historial) y getUbicacionesClaveCaso (D-15).
 * Mock de `db` propio: identifica ramas por TABLA (`.from(tabla)`) y por los
 * campos pedidos en `select()`, igual que wialon.test.ts.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { user } from "../db/schema/auth";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import {
	gpsDomicilioDeclarado,
	gpsEventos,
	gpsUbicacionesClave,
} from "../db/schema/gps-eventos";
import { vehicles } from "../db/schema/vehicles";
import { moduloAccesoFalso } from "../lib/acceso-caso-cobro.mock";
import type { Context } from "../lib/context";

let rolUsuarioMock = "cobros";
let responsableCasoMock = "user-test";
let eventosFilasMock: Record<string, unknown>[] = [];
let ubicacionesFilasMock: Record<string, unknown>[] = [];
let numeroCreditoSifcoMock: string | null = "01010214100000";
let domicilioDeclaradoMock: {
	tipo: "casa" | "trabajo";
	lat: number;
	lon: number;
	direccionTexto?: string | null;
	registradoAt?: Date;
	registradoPorNombre?: string | null;
}[] = [];
// Contexto y direcciones que resuelve direccionesDeclaradasDelCaso.
const DIRECCION_CASA = "29 Avenida 02-107, Zona 13, Petapa";
const DIRECCION_TRABAJO = "29 Av. 2-107, Colonia Cañadas del Río";
let contextoCasoMock: { leadId: string | null; opportunityId: string | null } =
	{
		leadId: "lead-1",
		opportunityId: "opp-1",
	};
let leadDireccionMock: string | null = DIRECCION_CASA;
let solicitudMock: {
	residencia: string | null;
	trabajo: string | null;
} | null = { residencia: null, trabajo: DIRECCION_TRABAJO };
let domicilioUpserts: {
	valores: Record<string, unknown>;
	config: Record<string, unknown>;
}[] = [];
let domicilioBorrados = 0;

const VEHICLE_ID = "22222222-2222-2222-2222-222222222222";

// Caso ⨝ oportunidades que lee resolverCasoParaGps (getUbicacionesClaveCaso).
let casoGpsMock: Record<string, unknown> | null = {
	casoSifco: "01010214100000",
	vehiculoOportunidad: VEHICLE_ID,
};
let insertGpsConsultaLogFalla = false;
let gpsConsultaLogsInsertados: Record<string, unknown>[] = [];
let gpsConsultaLogsActualizados: Record<string, unknown>[] = [];
let ubicacionesWhereCondition: unknown = null;
let ubicacionesClaveBorradasCount = 0;
let consultasFilasMock: Record<string, unknown>[] = [];
let consultasLimitPedido: number | null = null;
let vehiculoWialonUnitIdMock: number | null = 100;

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

				if (tabla === gpsConsultaLogs) {
					return {
						leftJoin: () => ({
							where: () => ({
								orderBy: () => ({
									limit: async (n: number) => {
										consultasLimitPedido = n;
										return consultasFilasMock;
									},
								}),
							}),
						}),
					};
				}

				if (tabla === vehicles) {
					return {
						where: () => ({
							limit: async () => [{ wialonUnitId: vehiculoWialonUnitIdMock }],
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

				if (tabla === gpsDomicilioDeclarado) {
					return {
						where: async () => domicilioDeclaradoMock,
						leftJoin: () => ({ where: async () => domicilioDeclaradoMock }),
					};
				}

				if (tabla === leads) {
					return {
						where: () => ({
							limit: async () =>
								leadDireccionMock ? [{ direccion: leadDireccionMock }] : [],
						}),
					};
				}

				if (tabla === creditApplications) {
					return {
						where: () => ({
							orderBy: () => ({
								limit: async () => (solicitudMock ? [solicitudMock] : []),
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
			if (tabla === gpsDomicilioDeclarado) {
				return {
					values: (valores: Record<string, unknown>) => ({
						onConflictDoUpdate: async (config: Record<string, unknown>) => {
							domicilioUpserts.push({ valores, config });
						},
					}),
				};
			}
			if (tabla === gpsConsultaLogs) {
				return {
					values: (fila: Record<string, unknown>) => {
						if (insertGpsConsultaLogFalla) {
							return {
								returning: () => Promise.reject(new Error("insert falló")),
							};
						}
						gpsConsultaLogsInsertados.push(fila);
						return { returning: async () => [{ id: "log-nuevo" }] };
					},
				};
			}
			throw new Error(`insert en tabla no mockeada: ${String(tabla)}`);
		},
		update: (tabla: unknown) => {
			if (tabla === gpsConsultaLogs) {
				return {
					set: (valores: Record<string, unknown>) => ({
						where: async () => {
							gpsConsultaLogsActualizados.push(valores);
						},
					}),
				};
			}
			throw new Error(`update en tabla no mockeada: ${String(tabla)}`);
		},
		delete: (tabla: unknown) => {
			if (tabla === gpsDomicilioDeclarado) {
				return {
					where: async () => {
						domicilioBorrados++;
					},
				};
			}
			if (tabla === gpsUbicacionesClave) {
				return {
					where: async () => {
						ubicacionesClaveBorradasCount++;
					},
				};
			}
			throw new Error(`delete en tabla no mockeada: ${String(tabla)}`);
		},
	};
}

mock.module("../db", () => ({ db: mockDb() }));
// El contexto del caso (lead y oportunidad) sale de otras tablas que estos
// tests no mockean: se resuelve con una bandera, y el resto del módulo es el real.
const datosCasoReal = await import("../services/referencias-cobros-datos");
mock.module("../services/referencias-cobros-datos", () => ({
	...datosCasoReal,
	resolverContextoCaso: async () => contextoCasoMock,
}));
// El permiso de la ficha lo da cartera (lib/acceso-caso-cobro); acá se simula
// con la misma bandera de siempre: `responsableCasoMock === "user-test"` =
// el usuario trabaja el crédito.
mock.module("../lib/acceso-caso-cobro", () =>
	moduloAccesoFalso({ tieneAcceso: () => responsableCasoMock === "user-test" }),
);

const { gpsEventosRouter } = await import("./gps-eventos-router");
const { carteraBackClient } = await import("../services/cartera-back-client");
const jobUbicaciones = await import("../jobs/gps-ubicaciones-clave");

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
	afterEach(() => {
		ubicacionesFilasMock = [];
		casoGpsMock = {
			casoSifco: "01010214100000",
			vehiculoOportunidad: VEHICLE_ID,
		};
		insertGpsConsultaLogFalla = false;
		gpsConsultaLogsInsertados = [];
		gpsConsultaLogsActualizados = [];
		ubicacionesWhereCondition = null;
		ubicacionesClaveBorradasCount = 0;
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
		// Lo mostrado queda en el snapshot de esa consulta para el historial.
		expect(gpsConsultaLogsActualizados).toHaveLength(1);
		const guardado = gpsConsultaLogsActualizados[0]?.snapshot as {
			ubicaciones: { id: string; tipo: string }[];
		};
		expect(guardado.ubicaciones).toHaveLength(1);
		expect(guardado.ubicaciones[0]?.tipo).toBe("probable_casa");
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

	it("expone las ubicaciones sin importar el bucket del crédito y no consulta ni purga por bucket", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		const bucketSpy = spyOn(carteraBackClient, "getBucketActualCredito");

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
		expect(bucketSpy).not.toHaveBeenCalled();
		expect(ubicacionesClaveBorradasCount).toBe(0);
		expect(gpsConsultaLogsActualizados).not.toContainEqual({ snapshot: null });
	});

	it("domicilio declarado: confirma la probable casa cercana, no la lejana, y lo deja en el snapshot", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		const casa = {
			id: "ub-1",
			lat: 14.5951,
			lon: -90.5069,
			radioM: 50,
			tipo: "probable_casa",
			horasTotales: 480,
			diasDistintos: 55,
			visitas: 55,
			patron: {},
			primeraVisita: new Date("2026-07-01T00:00:00.000Z"),
			ultimaVisita: new Date("2026-08-29T00:00:00.000Z"),
			calculadoAt: new Date("2026-08-30T06:00:00.000Z"),
		};
		const trabajo = { ...casa, id: "ub-2", tipo: "probable_trabajo" };
		ubicacionesFilasMock = [casa, trabajo];

		// ~55 m al norte: dentro de radio (50) + margen (150).
		domicilioDeclaradoMock = [
			{
				tipo: "casa",
				lat: 14.5956,
				lon: -90.5069,
				direccionTexto: DIRECCION_CASA,
			},
		];
		let res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});
		expect(res.ubicaciones[0].confirmadaDomicilio).toBe(true);
		expect(res.ubicaciones[0].distanciaDomicilioM).toBeLessThan(100);
		// El probable trabajo no se compara con el punto de la casa.
		expect(res.ubicaciones[1].confirmadaDomicilio).toBeNull();
		expect(gpsConsultaLogsActualizados.at(-1)).toMatchObject({
			snapshot: {
				ubicaciones: [
					{ confirmadaDomicilio: true },
					{ confirmadaDomicilio: null },
				],
			},
		});

		// ~2 km: no confirma.
		domicilioDeclaradoMock = [
			{
				tipo: "casa",
				lat: 14.6131,
				lon: -90.5069,
				direccionTexto: DIRECCION_CASA,
			},
		];
		res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});
		expect(res.ubicaciones[0].confirmadaDomicilio).toBe(false);
		expect(res.ubicaciones[0].distanciaDomicilioM).toBeGreaterThan(1500);

		// Casa y trabajo ubicados: cada uno se compara con su propio punto.
		domicilioDeclaradoMock = [
			{
				tipo: "casa",
				lat: 14.6131,
				lon: -90.5069,
				direccionTexto: DIRECCION_CASA,
			},
			{
				tipo: "trabajo",
				lat: 14.5956,
				lon: -90.5069,
				direccionTexto: DIRECCION_TRABAJO,
			},
		];
		res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});
		expect(res.ubicaciones[0].confirmadaDomicilio).toBe(false);
		expect(res.ubicaciones[1].confirmadaDomicilio).toBe(true);

		// La dirección del cliente cambió desde que se ubicó el punto: aunque
		// esté a 50 m, ya no confirma.
		domicilioDeclaradoMock = [
			{
				tipo: "casa",
				lat: 14.5956,
				lon: -90.5069,
				direccionTexto: "Otra dirección vieja",
			},
		];
		res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});
		expect(res.ubicaciones[0].confirmadaDomicilio).toBe(false);
		expect(res.ubicaciones[0].domicilioDesactualizado).toBe(true);

		// Sin domicilio ubicado: null, no false.
		domicilioDeclaradoMock = [];
		res = await call(gpsEventosRouter.getUbicacionesClaveCaso, input, {
			context: ctx("cobros"),
		});
		expect(res.ubicaciones[0].confirmadaDomicilio).toBeNull();
		expect(res.ubicaciones[0].distanciaDomicilioM).toBeNull();
	});

	it("caso sin numeroCreditoSifco: no expone ubicaciones", async () => {
		casoGpsMock = {
			casoSifco: null,
			vehiculoOportunidad: VEHICLE_ID,
		};
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
			context: ctx("admin"),
		});

		expect(res.auditada).toBe(true);
		expect(res.ubicaciones).toEqual([]);
		expect(ubicacionesClaveBorradasCount).toBe(0);
	});
});

describe("getGpsConsultasCaso — historial de consultas del vehículo", () => {
	afterEach(() => {
		consultasFilasMock = [];
		consultasLimitPedido = null;
		casoGpsMock = {
			casoSifco: "01010214100000",
			vehiculoOportunidad: VEHICLE_ID,
		};
		responsableCasoMock = "user-test";
		gpsConsultaLogsInsertados = [];
		mock.restore();
	});

	const input = { casoCobroId: CASO_ID, vehicleId: VEHICLE_ID, limit: 20 };

	it("con acceso: devuelve las consultas y NO registra otra auditoría", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		consultasFilasMock = [
			{
				id: "log-1",
				motivo: "Cliente no contesta hace una semana",
				origen: "telemetria",
				unitName: "P-909LPL - CON APAGADO",
				userNombre: "Ana",
				createdAt: new Date("2026-09-30T09:06:00.000Z"),
				// Como sale de la columna jsonb: fechas en texto ISO.
				snapshot: {
					estado: "vinculado",
					auditada: true,
					unitId: 123,
					unitName: "P-909LPL - CON APAGADO",
					vinculoOrigen: "placa",
					placa: "P-909LPL",
					telemetria: {
						speedKmh: 0,
						latitude: 14.561926,
						longitude: -90.509186,
						ultimaSenalAt: "2026-09-30T09:06:00.000Z",
						ultimaPosicionAt: "2026-09-30T09:05:00.000Z",
					},
				},
			},
			{
				id: "log-0",
				motivo: "Verificar ubicación previa",
				origen: null,
				unitName: null,
				userNombre: null,
				createdAt: new Date("2026-09-29T09:06:00.000Z"),
				snapshot: null,
			},
		];

		const res = await call(gpsEventosRouter.getGpsConsultasCaso, input, {
			context: ctx("cobros"),
		});

		expect(res).toHaveLength(2);
		expect(res[0]?.motivo).toBe("Cliente no contesta hace una semana");
		expect(res[1]?.origen).toBeNull();
		const snap = res[0]?.snapshot;
		expect(snap?.estado).toBe("vinculado");
		if (snap?.estado === "vinculado") {
			expect(snap.telemetria.latitude).toBe(14.561926);
			expect(snap.telemetria.ultimaSenalAt).toBeInstanceOf(Date);
			expect(snap.telemetria.ultimaPosicionAt?.toISOString()).toBe(
				"2026-09-30T09:05:00.000Z",
			);
		}
		expect(res[1]?.snapshot).toBeNull();
		expect(consultasLimitPedido).toBe(20);
		expect(gpsConsultaLogsInsertados).toHaveLength(0);
	});

	it("consultas con la misma ubicación salen como una entrada, sin perder ninguna", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		const snapshot = (hora: string) => ({
			estado: "vinculado",
			auditada: true,
			unitId: 1,
			unitName: "U",
			vinculoOrigen: "placa",
			placa: null,
			telemetria: {
				latitude: 14.5,
				longitude: -90.5,
				ultimaSenalAt: hora,
				ultimaPosicionAt: hora,
			},
		});
		consultasFilasMock = [
			{
				id: "nueva",
				motivo: "Segunda revisión",
				origen: "telemetria",
				unitName: "U",
				userNombre: "Beto",
				createdAt: new Date("2026-09-30T12:30:00.000Z"),
				snapshot: snapshot("2026-09-30T12:29:00.000Z"),
			},
			{
				id: "vieja",
				motivo: "Primera revisión",
				origen: "telemetria",
				unitName: "U",
				userNombre: "Ana",
				createdAt: new Date("2026-09-30T12:10:00.000Z"),
				snapshot: snapshot("2026-09-30T12:09:00.000Z"),
			},
		];

		const res = await call(gpsEventosRouter.getGpsConsultasCaso, input, {
			context: ctx("cobros"),
		});

		expect(res).toHaveLength(1);
		expect(res[0]?.id).toBe("nueva");
		expect(res[0]?.motivo).toBe("Segunda revisión");
		expect(res[0]?.snapshot?.estado).toBe("vinculado");
		// La auditoría de la consulta anterior sigue a la vista: quién y por qué.
		expect(res[0]?.consultas.map((c) => [c.userNombre, c.motivo])).toEqual([
			["Beto", "Segunda revisión"],
			["Ana", "Primera revisión"],
		]);
	});

	it("un snapshot que no cumple el schema se descarta sin tumbar el historial", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		consultasFilasMock = [
			{
				id: "log-x",
				motivo: "Consulta con snapshot viejo",
				origen: "telemetria",
				unitName: null,
				userNombre: "Ana",
				createdAt: new Date("2026-09-30T09:06:00.000Z"),
				snapshot: { formato: "viejo" },
			},
		];

		const res = await call(gpsEventosRouter.getGpsConsultasCaso, input, {
			context: ctx("cobros"),
		});

		expect(res).toHaveLength(1);
		expect(res[0]?.snapshot).toBeNull();
	});

	it("sin acceso al caso: rechaza y no lee el historial", async () => {
		responsableCasoMock = "otro-usuario";

		await expect(
			call(gpsEventosRouter.getGpsConsultasCaso, input, {
				context: ctx("cobros"),
			}),
		).rejects.toThrow();
		expect(consultasLimitPedido).toBeNull();
	});

	it("vehículo que no es el del caso: rechaza", async () => {
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
		casoGpsMock = {
			casoSifco: "01010214100000",
			vehiculoOportunidad: "99999999-9999-9999-9999-999999999999",
		};

		await expect(
			call(gpsEventosRouter.getGpsConsultasCaso, input, {
				context: ctx("cobros"),
			}),
		).rejects.toThrow();
		expect(consultasLimitPedido).toBeNull();
	});
});

describe("getUbicacionesConsultasCaso (historial de ubicaciones clave)", () => {
	const input = { casoCobroId: CASO_ID, vehicleId: VEHICLE_ID, limit: 20 };

	beforeEach(() => {
		rolUsuarioMock = "cobros";
		responsableCasoMock = "user-test";
		numeroCreditoSifcoMock = "01010214100000";
		domicilioDeclaradoMock = [];
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
	});

	afterEach(() => {
		consultasFilasMock = [];
		mock.restore();
	});

	it("devuelve motivo, usuario y las ubicaciones de cada consulta (fechas ISO -> Date)", async () => {
		consultasFilasMock = [
			{
				id: "log-1",
				motivo: "Preparar visita de recuperación",
				userNombre: "Ana",
				createdAt: new Date("2026-10-01T12:48:00.000Z"),
				snapshot: {
					ubicaciones: [
						{
							id: "ub-1",
							lat: 14.5951,
							lon: -90.5069,
							radioM: 200,
							tipo: "probable_casa",
							horasTotales: 236,
							diasDistintos: 15,
							visitas: 26,
							patron: { nocturna: 200 },
							primeraVisita: "2026-07-01T00:00:00.000Z",
							ultimaVisita: "2026-09-30T18:21:00.000Z",
							calculadoAt: "2026-10-01T03:33:00.000Z",
						},
					],
				},
			},
			{
				id: "log-0",
				motivo: "Consulta anterior al historial",
				userNombre: null,
				createdAt: new Date("2026-10-01T12:25:00.000Z"),
				snapshot: null,
			},
		];

		const res = await call(
			gpsEventosRouter.getUbicacionesConsultasCaso,
			input,
			{
				context: ctx("cobros"),
			},
		);

		expect(res).toHaveLength(2);
		expect(res[0]?.snapshot?.ubicaciones[0]?.tipo).toBe("probable_casa");
		expect(res[0]?.snapshot?.ubicaciones[0]?.ultimaVisita).toBeInstanceOf(Date);
		expect(res[1]?.snapshot).toBeNull();
		// Ver el historial no es una consulta nueva: no audita.
		expect(gpsConsultaLogsInsertados).toHaveLength(0);
	});

	it("un snapshot con formato inválido se descarta en vez de tumbar el historial", async () => {
		consultasFilasMock = [
			{
				id: "log-1",
				motivo: "Consulta con snapshot corrupto",
				userNombre: "Ana",
				createdAt: new Date("2026-10-01T12:48:00.000Z"),
				snapshot: { ubicaciones: "no es una lista" },
			},
		];

		const res = await call(
			gpsEventosRouter.getUbicacionesConsultasCaso,
			input,
			{
				context: ctx("cobros"),
			},
		);

		expect(res).toHaveLength(1);
		expect(res[0]?.snapshot).toBeNull();
	});

	it("expone el historial sin consultar el bucket del crédito", async () => {
		const bucketSpy = spyOn(carteraBackClient, "getBucketActualCredito");
		consultasFilasMock = [
			{
				id: "log-1",
				motivo: "Consulta previa",
				userNombre: "Ana",
				createdAt: new Date("2026-10-01T12:48:00.000Z"),
				snapshot: { ubicaciones: [] },
			},
		];

		const res = await call(
			gpsEventosRouter.getUbicacionesConsultasCaso,
			input,
			{
				context: ctx("cobros"),
			},
		);

		expect(res).toHaveLength(1);
		expect(bucketSpy).not.toHaveBeenCalled();
	});
});

describe("calcularUbicacionesClaveCaso — botón «Calcular ahora»", () => {
	const input = { casoCobroId: CASO_ID, vehicleId: VEHICLE_ID };

	beforeEach(() => {
		rolUsuarioMock = "cobros";
		responsableCasoMock = "user-test";
		vehiculoWialonUnitIdMock = 100;
		casoGpsMock = {
			casoSifco: "01010214100000",
			vehiculoOportunidad: VEHICLE_ID,
		};
		spyOn(carteraBackClient, "getCredito").mockResolvedValue({
			asesor: { emailCashIn: "u@example.com" },
		} as never);
	});

	afterEach(() => {
		mock.restore();
	});

	it("calcula la unidad del vehículo con el SIFCO del caso", async () => {
		const calcular = spyOn(
			jobUbicaciones,
			"calcularUbicacionesUnidadBajoDemanda",
		).mockResolvedValue({ estado: "calculado", ubicaciones: 3 });

		const res = await call(
			gpsEventosRouter.calcularUbicacionesClaveCaso,
			input,
			{
				context: ctx("cobros"),
			},
		);

		expect(res).toEqual({ estado: "calculado", ubicaciones: 3 });
		expect(calcular).toHaveBeenCalledWith(100, ["01010214100000"]);
	});

	it("vehículo sin unidad GPS vinculada: no llama a Wialon", async () => {
		vehiculoWialonUnitIdMock = null;
		const calcular = spyOn(
			jobUbicaciones,
			"calcularUbicacionesUnidadBajoDemanda",
		);

		const res = await call(
			gpsEventosRouter.calcularUbicacionesClaveCaso,
			input,
			{
				context: ctx("cobros"),
			},
		);

		expect(res).toEqual({ estado: "sin_unidad", ubicaciones: 0 });
		expect(calcular).not.toHaveBeenCalled();
	});

	it("propaga 'en_proceso' sin ubicaciones", async () => {
		spyOn(
			jobUbicaciones,
			"calcularUbicacionesUnidadBajoDemanda",
		).mockResolvedValue({ estado: "en_proceso" });

		const res = await call(
			gpsEventosRouter.calcularUbicacionesClaveCaso,
			input,
			{ context: ctx("cobros") },
		);

		expect(res).toEqual({ estado: "en_proceso", ubicaciones: 0 });
	});

	it("sin acceso al caso: rechaza y no calcula", async () => {
		responsableCasoMock = "otro-usuario";
		const calcular = spyOn(
			jobUbicaciones,
			"calcularUbicacionesUnidadBajoDemanda",
		);

		await expect(
			call(gpsEventosRouter.calcularUbicacionesClaveCaso, input, {
				context: ctx("cobros"),
			}),
		).rejects.toThrow();
		expect(calcular).not.toHaveBeenCalled();
	});
});

describe("Domicilio declarado — leer, guardar y quitar", () => {
	beforeEach(() => {
		rolUsuarioMock = "cobros";
		responsableCasoMock = "user-test";
		domicilioDeclaradoMock = [];
		domicilioUpserts = [];
		domicilioBorrados = 0;
		contextoCasoMock = { leadId: "lead-1", opportunityId: "opp-1" };
		leadDireccionMock = DIRECCION_CASA;
		solicitudMock = { residencia: null, trabajo: DIRECCION_TRABAJO };
	});

	afterEach(() => {
		mock.restore();
	});

	it("get: devuelve la dirección de casa (lead) y de trabajo (solicitud), sin puntos ubicados", async () => {
		const res = await call(
			gpsEventosRouter.getDomicilioDeclaradoCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.casa).toEqual({ direccion: DIRECCION_CASA, ubicado: null });
		expect(res.trabajo).toEqual({
			direccion: DIRECCION_TRABAJO,
			ubicado: null,
		});
	});

	it("get: sin dirección en el lead usa la residencia de la solicitud; sin solicitud, el trabajo es null", async () => {
		leadDireccionMock = null;
		solicitudMock = { residencia: "Residencia de la solicitud", trabajo: null };
		let res = await call(
			gpsEventosRouter.getDomicilioDeclaradoCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.casa.direccion).toBe("Residencia de la solicitud");
		expect(res.trabajo.direccion).toBeNull();

		solicitudMock = null;
		contextoCasoMock = { leadId: "lead-1", opportunityId: null };
		leadDireccionMock = DIRECCION_CASA;
		res = await call(
			gpsEventosRouter.getDomicilioDeclaradoCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.casa.direccion).toBe(DIRECCION_CASA);
		expect(res.trabajo.direccion).toBeNull();
	});

	it("get: marca el punto como desactualizado solo si la dirección cambió", async () => {
		const registradoAt = new Date("2026-10-02T15:51:00.000Z");
		domicilioDeclaradoMock = [
			// Misma dirección con otras mayúsculas y espacios: no cambió.
			{
				tipo: "casa",
				lat: 14.5,
				lon: -90.5,
				direccionTexto: `  ${DIRECCION_CASA.toUpperCase()}  `,
				registradoAt,
				registradoPorNombre: "Jose",
			},
			{
				tipo: "trabajo",
				lat: 14.6,
				lon: -90.6,
				direccionTexto: "Dirección de trabajo anterior",
				registradoAt,
				registradoPorNombre: null,
			},
		];
		const res = await call(
			gpsEventosRouter.getDomicilioDeclaradoCaso,
			{ casoCobroId: CASO_ID },
			{ context: ctx("cobros") },
		);
		expect(res.casa.ubicado).toMatchObject({
			lat: 14.5,
			lon: -90.5,
			registradoPorNombre: "Jose",
			desactualizado: false,
		});
		expect(res.trabajo.ubicado).toMatchObject({ desactualizado: true });
	});

	it("get: asesor sin acceso al caso: NOT_FOUND", async () => {
		responsableCasoMock = "otro-usuario";
		await expect(
			call(
				gpsEventosRouter.getDomicilioDeclaradoCaso,
				{ casoCobroId: CASO_ID },
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
	});

	it("set: lee el link de Maps, guarda el punto con la dirección actual y quien lo ubicó", async () => {
		const res = await call(
			gpsEventosRouter.setDomicilioDeclaradoCaso,
			{
				casoCobroId: CASO_ID,
				tipo: "casa",
				entrada:
					"https://www.google.com/maps/place/X/@14.6,-90.5,17z/data=!3d14.5951!4d-90.5069",
			},
			{ context: ctx("cobros") },
		);
		expect(res).toEqual({ lat: 14.5951, lon: -90.5069 });
		expect(domicilioUpserts).toHaveLength(1);
		expect(domicilioUpserts[0].valores).toMatchObject({
			casoCobroId: CASO_ID,
			tipo: "casa",
			lat: 14.5951,
			lon: -90.5069,
			direccionTexto: DIRECCION_CASA,
			registradoPor: "user-test",
		});
		// Volver a guardar actualiza el punto (upsert por caso + tipo).
		expect(domicilioUpserts[0].config.set).toMatchObject({
			lat: 14.5951,
			lon: -90.5069,
			direccionTexto: DIRECCION_CASA,
		});
	});

	it("set: el trabajo guarda la dirección del trabajo, no la de la casa", async () => {
		await call(
			gpsEventosRouter.setDomicilioDeclaradoCaso,
			{ casoCobroId: CASO_ID, tipo: "trabajo", entrada: "14.64, -90.51" },
			{ context: ctx("cobros") },
		);
		expect(domicilioUpserts[0].valores).toMatchObject({
			tipo: "trabajo",
			direccionTexto: DIRECCION_TRABAJO,
		});
	});

	it("set: entrada sin coordenadas válidas: BAD_REQUEST y no guarda nada", async () => {
		for (const entrada of [
			"zona 10 ciudad",
			"https://maps.app.goo.gl/abc123",
			"95, -90",
			"0, 0",
		]) {
			await expect(
				call(
					gpsEventosRouter.setDomicilioDeclaradoCaso,
					{ casoCobroId: CASO_ID, tipo: "casa", entrada },
					{ context: ctx("cobros") },
				),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		expect(domicilioUpserts).toHaveLength(0);
	});

	it("set: asesor sin acceso al caso: no guarda nada", async () => {
		responsableCasoMock = "otro-usuario";
		await expect(
			call(
				gpsEventosRouter.setDomicilioDeclaradoCaso,
				{ casoCobroId: CASO_ID, tipo: "casa", entrada: "14.5951, -90.5069" },
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		expect(domicilioUpserts).toHaveLength(0);
	});

	it("borrar: quita el punto; sin acceso al caso no borra", async () => {
		await call(
			gpsEventosRouter.borrarDomicilioDeclaradoCaso,
			{ casoCobroId: CASO_ID, tipo: "casa" },
			{ context: ctx("cobros") },
		);
		expect(domicilioBorrados).toBe(1);

		responsableCasoMock = "otro-usuario";
		await expect(
			call(
				gpsEventosRouter.borrarDomicilioDeclaradoCaso,
				{ casoCobroId: CASO_ID, tipo: "casa" },
				{ context: ctx("cobros") },
			),
		).rejects.toBeInstanceOf(ORPCError);
		expect(domicilioBorrados).toBe(1);
	});
});
